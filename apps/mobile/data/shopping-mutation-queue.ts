import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { z } from 'zod';

import { parseCheapoApiOrigin } from '../lib/cheapo-access/origin';
import type { PriceAppendReceipt, PriceQueueOwner } from './price-append-queue';
import {
  mutationOperationId, mutationReceipt, mutationResource, mutationVersion, requestForMutation, shoppingMutation,
  type MutationRequest, type ShoppingMutation, type ShoppingMutationInput,
} from './shopping-mutations';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const storedRequest = z.strictObject({
  path: z.string().regex(/^\/v1\/(?:products\/[^/?#]+|me\/(?:saved-shops\/[^/?#]+|current-shop|comparison-preferences\/[^/?#]+|price-observations\/[^/?#]+))$/),
  method: z.enum(['PUT', 'PATCH', 'DELETE']),
  body: z.string().max(8192).optional(),
});
const outcome = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('applied'), receipt: mutationReceipt }),
  z.strictObject({ kind: z.literal('conflict'), currentVersion: mutationVersion, current: z.json() }),
]);
const failure = z.enum(['offline', 'access', 'service']);
const conditionalRequest = z.object({ operationId: mutationOperationId, expectedVersion: mutationVersion });

type MutationOutcome = z.infer<typeof outcome>;
type MutationFailure = z.infer<typeof failure>;
export type QueuedShoppingMutation = {
  intent: ShoppingMutation;
  request?: MutationRequest;
  outcome?: MutationOutcome;
  failure?: MutationFailure;
};
type Recovery = { operationId: string; reason: 'unfinished' | 'unreadable' };
type AppendReceiptReader = (sourceId: string) => Promise<PriceAppendReceipt | undefined>;
type Phase = 'intent' | 'request' | 'outcome' | 'failure';

let activePublication: Promise<unknown> = Promise.resolve();
function serializePublication<T>(write: () => Promise<T>): Promise<T> {
  const result = activePublication.then(write);
  activePublication = result.catch(() => {});
  return result;
}

async function readJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

function operationBase(intent: ShoppingMutation) {
  return 'base' in intent.action ? intent.action.base : undefined;
}

function validateOutcome(intent: ShoppingMutation, request: MutationRequest, result: MutationOutcome) {
  if (request.method === 'PATCH') {
    const parsed = conditionalRequest.parse(JSON.parse(request.body ?? '{}'));
    const expected = parsed.expectedVersion;
    const actual = result.kind === 'applied' ? result.receipt.version : result.currentVersion;
    if (parsed.operationId !== intent.operationId || typeof actual !== typeof expected || actual === expected ||
      (result.kind === 'applied' && typeof expected === 'number' && actual !== expected + 1)) {
      throw Error('The shopping outcome version is invalid.');
    }
  }
  if (result.kind !== 'applied') return;
  const { id, version } = result.receipt;
  const action = intent.action;
  switch (action.kind) {
    case 'create-product':
    case 'edit-product':
      if (id !== action.product.id || typeof version !== 'number' || version < 1) {
        throw Error('The product acknowledgement ID or version is invalid.');
      }
      break;
    case 'save-shop':
    case 'edit-shop':
      if (id !== (action.kind === 'save-shop' ? action.shop.id : action.shopId) || typeof version !== 'string') {
        throw Error('The saved-shop acknowledgement ID or version is invalid.');
      }
      break;
    case 'price':
      if (!request.path.endsWith('/' + id)) throw Error('The price acknowledgement is for a different record.');
      break;
  }
}

export async function openShoppingMutationQueue(input: PriceQueueOwner) {
  const origin = parseCheapoApiOrigin(input.origin);
  if (!origin || !uuid.test(input.householdId) || !uuid.test(input.shopperId)) throw Error('Invalid shopping queue owner.');
  const owner = Object.freeze({ origin, householdId: input.householdId, shopperId: input.shopperId });
  const scope = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([origin, owner.householdId, owner.shopperId]));
  const directory = new Directory(new Directory(Paths.document, 'cheapo-shopping-mutations-v1'), scope);
  const phaseFile = (operationId: string, phase: Phase) => new File(directory, `${mutationOperationId.parse(operationId)}.${phase}.json`);

  async function publish(file: File, text: string) {
    if (file.exists) {
      if (await file.text() !== text) throw Error('Different shopping work already uses this operation ID.');
      return;
    }
    directory.create({ intermediates: true, idempotent: true });
    const pending = new File(directory, `${file.name}.${randomUUID()}.pending`);
    await pending.write(text);
    await pending.move(file, { overwrite: false });
  }

  async function readIntent(operationId: string): Promise<ShoppingMutation> {
    const value = await readJson(phaseFile(operationId, 'intent'));
    if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 1
      || !('owner' in value) || JSON.stringify(value.owner) !== JSON.stringify(owner) || !('intent' in value)) {
      throw Error('The queued shopping owner is invalid.');
    }
    const intent = shoppingMutation.parse(value.intent);
    if (intent.operationId !== operationId) throw Error('The queued operation ID does not match.');
    return intent;
  }

  async function readPhase<T>(operationId: string, phase: Exclude<Phase, 'intent'>, schema: z.ZodType<T>) {
    const file = phaseFile(operationId, phase);
    if (!file.exists) return undefined;
    const value = await readJson(file);
    if (!value || typeof value !== 'object' || !('operationId' in value) || value.operationId !== operationId || !('data' in value)) {
      throw Error('The shopping operation stage is invalid.');
    }
    return schema.parse(value.data);
  }

  async function readEntry(operationId: string): Promise<QueuedShoppingMutation> {
    const intent = await readIntent(operationId);
    const request = await readPhase(operationId, 'request', storedRequest);
    const result = await readPhase(operationId, 'outcome', outcome);
    const failed = await readPhase(operationId, 'failure', failure);
    if ((result || failed) && !request) throw Error('The shopping request is missing.');
    if (result && request) validateOutcome(intent, request, result);
    return { intent, ...(request ? { request } : {}), ...(result ? { outcome: result } : failed ? { failure: failed } : {}) };
  }

  function writePhase<T>(operationId: string, phase: Exclude<Phase, 'intent'>, data: T) {
    return publish(phaseFile(operationId, phase), JSON.stringify({ operationId, data }));
  }

  return {
    owner,
    enqueue(input: ShoppingMutationInput) {
      const intent = shoppingMutation.parse(input);
      const { operationId, waitFor } = intent;
      const base = operationBase(intent);
      const predecessors = new Set(base?.kind === 'operation' ? [...waitFor, base.operationId] : waitFor);
      if (predecessors.has(operationId)) throw Error('A shopping operation cannot depend on itself.');
      return serializePublication(async () => {
        for (const earlier of predecessors) {
          const preceding = await readIntent(earlier);
          if (base?.kind === 'operation' && earlier === base.operationId &&
            mutationResource(preceding.action) !== mutationResource(intent.action)) {
            throw Error('The previous shopping edit belongs to a different record.');
          }
        }
        await publish(phaseFile(operationId, 'intent'), JSON.stringify({ format: 1, owner, intent }));
      });
    },
    async read() {
      await activePublication;
      const entries: QueuedShoppingMutation[] = [];
      const recovery: Recovery[] = [];
      if (!directory.exists) return { entries, recovery };
      for (const file of directory.list()) {
        const match = /^([\w-]{1,128})\.(intent|request|outcome|failure)\.json(?:\.[\w-]+\.(pending))?$/.exec(file.name);
        if (!match) continue;
        const [, operationId, phase, pending] = match;
        if (pending) {
          try {
            const committed = phaseFile(operationId, phase as Phase);
            if (file instanceof File && committed.exists && await file.text() === await committed.text()) continue;
          } catch { /* The unfinished stage remains available for recovery. */ }
          recovery.push({ operationId, reason: 'unfinished' });
        } else if (phase === 'intent') {
          try {
            entries.push(await readEntry(operationId));
          } catch {
            try { entries.push({ intent: await readIntent(operationId) }); } catch { /* The intent is also unreadable. */ }
            recovery.push({ operationId, reason: 'unreadable' });
          }
        } else if (!phaseFile(operationId, 'intent').exists) {
          recovery.push({ operationId, reason: 'unreadable' });
        }
      }
      entries.sort((first, second) => first.intent.createdAt.localeCompare(second.intent.createdAt) ||
        first.intent.operationId.localeCompare(second.intent.operationId));
      return { entries, recovery };
    },
    freeze(operationId: string, loadAppendReceipt?: AppendReceiptReader) {
      return serializePublication(async () => {
        const entry = await readEntry(operationId);
        if (entry.outcome) return undefined;
        if (entry.request) return entry.request;
        for (const earlier of entry.intent.waitFor) {
          const previous = await readEntry(earlier);
          if (previous.outcome?.kind !== 'applied') return undefined;
        }
        const base = operationBase(entry.intent);
        let predecessor: z.infer<typeof mutationReceipt> | undefined;
        if (base?.kind === 'operation') {
          const previous = await readEntry(base.operationId);
          if (previous.outcome?.kind !== 'applied') return undefined;
          predecessor = previous.outcome.receipt;
        } else if (base?.kind === 'append') {
          const receipt = await loadAppendReceipt?.(base.sourceId);
          if (!receipt || receipt.sourceId !== base.sourceId) return undefined;
          predecessor = mutationReceipt.parse({ id: receipt.id, version: receipt.version });
        }
        const request = requestForMutation(entry.intent, predecessor);
        if (!request) return undefined;
        await writePhase(operationId, 'request', storedRequest.parse(request));
        return request;
      });
    },
    settle(operationId: string, value: MutationOutcome) {
      const result = outcome.parse(value);
      return serializePublication(async () => {
        const entry = await readEntry(operationId);
        if (!entry.request) throw Error('Freeze the shopping request before recording its outcome.');
        validateOutcome(entry.intent, entry.request, result);
        await writePhase(operationId, 'outcome', result);
      });
    },
    fail(operationId: string, reason: MutationFailure) {
      const savedReason = failure.parse(reason);
      return serializePublication(async () => {
        const entry = await readEntry(operationId);
        if (!entry.request || entry.outcome || entry.failure) return;
        await writePhase(operationId, 'failure', savedReason);
      });
    },
  };
}

export type ShoppingMutationQueue = Awaited<ReturnType<typeof openShoppingMutationQueue>>;
