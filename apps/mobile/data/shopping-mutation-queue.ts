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
const resolution = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('keep-phone'), replacementId: mutationOperationId }),
  z.strictObject({ kind: z.literal('keep-cloud'), laterIds: z.array(mutationOperationId) }),
]);

type MutationOutcome = z.infer<typeof outcome>;
type MutationFailure = z.infer<typeof failure>;
type MutationResolution = z.infer<typeof resolution>;
type ConflictChoice = { kind: 'keep-phone'; replacementId: string; createdAt: string } | { kind: 'keep-cloud'; laterIds: string[] };
export type QueuedShoppingMutation = {
  intent: ShoppingMutation;
  request?: MutationRequest;
  outcome?: MutationOutcome;
  failure?: MutationFailure;
  resolution?: MutationResolution;
  resolves?: string;
  superseded?: true;
};
type Recovery = { operationId: string; reason: 'unfinished' | 'unreadable' };
type AppendReceiptReader = (sourceId: string) => Promise<PriceAppendReceipt | undefined>;
type Phase = 'intent' | 'request' | 'outcome' | 'failure' | 'resolution';

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

function predecessors(intent: ShoppingMutation) {
  const base = operationBase(intent);
  return base?.kind === 'operation' ? [...intent.waitFor, base.operationId] : intent.waitFor;
}

function confirmedQueue(entries: readonly QueuedShoppingMutation[]) {
  const resolved = new Map(entries.map(entry => [entry.intent.operationId, entry.resolution]));
  return entries.filter(({ intent, resolves }) => {
    if (!resolves) return true;
    const prior = resolved.get(resolves);
    return prior?.kind === 'keep-phone' && prior.replacementId === intent.operationId;
  });
}

function supersededIds(entries: readonly QueuedShoppingMutation[]) {
  return new Set(entries.flatMap(({ resolution }) => resolution?.kind === 'keep-cloud' ? resolution.laterIds : []));
}

function dependentLocalEdits(entries: readonly QueuedShoppingMutation[], conflict: QueuedShoppingMutation) {
  const index = new Map(entries.map(entry => [entry.intent.operationId, entry]));
  const branch = new Set([conflict.intent.operationId]);
  let ancestor = conflict.resolves;
  while (ancestor && !branch.has(ancestor)) {
    branch.add(ancestor);
    ancestor = index.get(ancestor)?.resolves;
  }
  const resource = mutationResource(conflict.intent.action);
  const superseded = supersededIds(entries);
  function usesBranch(operationId: string, seen: Set<string>): boolean {
    if (branch.has(operationId)) return true;
    const previous = index.get(operationId);
    if (!previous || seen.has(operationId) || mutationResource(previous.intent.action) !== resource) return false;
    seen.add(operationId);
    return predecessors(previous.intent).some(id => usesBranch(id, seen));
  }
  return entries.filter(entry => !entry.outcome && !superseded.has(entry.intent.operationId)
    && !branch.has(entry.intent.operationId) && usesBranch(entry.intent.operationId, new Set()))
    .map(({ intent }) => ({ id: intent.operationId, title: intent.title }));
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

  async function readIntent(operationId: string) {
    const value = await readJson(phaseFile(operationId, 'intent'));
    if (!value || typeof value !== 'object' || !('format' in value) || value.format !== 1
      || !('owner' in value) || JSON.stringify(value.owner) !== JSON.stringify(owner) || !('intent' in value)) {
      throw Error('The queued shopping owner is invalid.');
    }
    const intent = shoppingMutation.parse(value.intent);
    if (intent.operationId !== operationId) throw Error('The queued operation ID does not match.');
    const resolves = 'resolves' in value ? mutationOperationId.parse(value.resolves) : undefined;
    return { intent, resolves };
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
    const { intent, resolves } = await readIntent(operationId);
    const request = await readPhase(operationId, 'request', storedRequest);
    const result = await readPhase(operationId, 'outcome', outcome);
    const failed = await readPhase(operationId, 'failure', failure);
    const chosen = await readPhase(operationId, 'resolution', resolution);
    if ((result || failed) && !request) throw Error('The shopping request is missing.');
    if (result && request) validateOutcome(intent, request, result);
    if (chosen && result?.kind !== 'conflict') throw Error('The shopping conflict is missing.');
    return { intent, ...(request ? { request } : {}), ...(result ? { outcome: result } : failed ? { failure: failed } : {}),
      ...(chosen ? { resolution: chosen } : {}), ...(resolves ? { resolves } : {}) };
  }

  function writePhase<T>(operationId: string, phase: Exclude<Phase, 'intent'>, data: T) {
    return publish(phaseFile(operationId, phase), JSON.stringify({ operationId, data }));
  }

  async function readAll() {
    const entries: QueuedShoppingMutation[] = [];
    const recovery: Recovery[] = [];
    if (directory.exists) {
      for (const file of directory.list()) {
        const match = /^([\w-]{1,128})\.(intent|request|outcome|failure|resolution)\.json(?:\.[\w-]+\.(pending))?$/.exec(file.name);
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
            try { entries.push(await readIntent(operationId)); } catch { /* The intent is also unreadable. */ }
            recovery.push({ operationId, reason: 'unreadable' });
          }
        } else if (!phaseFile(operationId, 'intent').exists) {
          recovery.push({ operationId, reason: 'unreadable' });
        }
      }
    }
    entries.sort((first, second) => first.intent.createdAt.localeCompare(second.intent.createdAt) ||
      first.intent.operationId.localeCompare(second.intent.operationId));
    return { entries, recovery };
  }

  function acceptedResult(operationId: string, entries: ReadonlyMap<string, QueuedShoppingMutation>, superseded: ReadonlySet<string>) {
    const seen = new Set<string>();
    let current = entries.get(operationId);
    while (current && !seen.has(current.intent.operationId)) {
      seen.add(current.intent.operationId);
      if (superseded.has(current.intent.operationId) || current.resolution?.kind === 'keep-cloud') return 'cloud';
      if (current.outcome?.kind === 'applied') return current.outcome.receipt;
      if (current.resolution?.kind !== 'keep-phone') break;
      const replacement = entries.get(current.resolution.replacementId);
      if (replacement?.resolves !== current.intent.operationId
        || mutationResource(replacement.intent.action) !== mutationResource(current.intent.action)) break;
      current = replacement;
    }
  }

  return {
    owner,
    enqueue(input: ShoppingMutationInput) {
      const intent = shoppingMutation.parse(input);
      const { operationId } = intent;
      const base = operationBase(intent);
      const dependencies = new Set(predecessors(intent));
      if (dependencies.has(operationId)) throw Error('A shopping operation cannot depend on itself.');
      return serializePublication(async () => {
        const file = phaseFile(operationId, 'intent');
        const body = JSON.stringify({ format: 1, owner, intent });
        if (file.exists) return publish(file, body);
        const entries = dependencies.size ? confirmedQueue((await readAll()).entries) : [];
        const indexed = new Map(entries.map(entry => [entry.intent.operationId, entry]));
        const superseded = supersededIds(entries);
        for (const earlier of dependencies) {
          const { intent: preceding } = await readIntent(earlier);
          const sameRecord = mutationResource(preceding.action) === mutationResource(intent.action);
          if (base?.kind === 'operation' && earlier === base.operationId && !sameRecord) {
            throw Error('The previous shopping edit belongs to a different record.');
          }
          if (sameRecord && acceptedResult(earlier, indexed, superseded) === 'cloud') {
            throw Error('The cloud version was kept. Reopen this record before editing.');
          }
        }
        await publish(file, body);
      });
    },
    async read() {
      await activePublication;
      const snapshot = await readAll();
      const entries = confirmedQueue(snapshot.entries);
      const superseded = supersededIds(entries);
      return {
        entries: entries.map(entry => superseded.has(entry.intent.operationId) ? { ...entry, superseded: true as const } : entry),
        recovery: snapshot.recovery,
      };
    },
    async laterEdits(operationId: string) {
      await activePublication;
      const entries = confirmedQueue((await readAll()).entries);
      const conflict = entries.find(entry => entry.intent.operationId === operationId);
      return conflict?.outcome?.kind === 'conflict' && !conflict.resolution ? dependentLocalEdits(entries, conflict) : [];
    },
    resolve(operationId: string, choice: ConflictChoice) {
      return serializePublication(async () => {
        const entry = await readEntry(operationId);
        if (!entry.request || entry.outcome?.kind !== 'conflict') throw Error('Reopen this shopping conflict before choosing a version.');
        const chosen = resolution.parse(choice.kind === 'keep-cloud' ? { ...choice, laterIds: [...choice.laterIds].sort() }
          : { kind: 'keep-phone', replacementId: choice.replacementId });
        if (entry.resolution) {
          if (JSON.stringify(chosen) !== JSON.stringify(entry.resolution)) throw Error('A version has already been chosen for this conflict.');
          return;
        }
        const entries = confirmedQueue((await readAll()).entries);
        if (!entries.some(available => available.intent.operationId === operationId)) throw Error('This shopping edit is still waiting for confirmation.');
        if (choice.kind === 'keep-cloud' && chosen.kind === 'keep-cloud') {
          const dependentIds = dependentLocalEdits(entries, entry).map(item => item.id).sort();
          if (JSON.stringify(dependentIds) !== JSON.stringify(chosen.laterIds)) {
            throw Error('Later edits changed. Review them before keeping the cloud version.');
          }
        }
        if (choice.kind === 'keep-phone') {
          if (choice.replacementId === operationId || !operationBase(entry.intent)) throw Error('This shopping change cannot be retried as an edit.');
          const { action } = entry.intent;
          const base = { kind: 'version', version: entry.outcome.currentVersion };
          const replacement = shoppingMutation.parse({
            ...entry.intent, operationId: choice.replacementId, createdAt: choice.createdAt,
            action: { ...action, base: action.kind === 'price' ? { ...base, id: entry.request.path.split('/').at(-1) } : base },
          });
          await publish(phaseFile(replacement.operationId, 'intent'), JSON.stringify({ format: 1, owner, intent: replacement, resolves: operationId }));
        }
        await writePhase(operationId, 'resolution', chosen);
      });
    },
    freeze(operationId: string, loadAppendReceipt?: AppendReceiptReader) {
      return serializePublication(async () => {
        const entry = await readEntry(operationId);
        if (entry.outcome) return undefined;
        const { entries: all } = await readAll();
        const active = confirmedQueue(all);
        const superseded = supersededIds(active);
        const index = new Map(active.map(item => [item.intent.operationId, item]));
        if (!index.has(operationId) || superseded.has(operationId)) return undefined;
        if (entry.request) return entry.request;
        for (const earlier of entry.intent.waitFor) {
          const result = acceptedResult(earlier, index, superseded);
          const dependency = index.get(earlier);
          if (!result || !dependency
            || (result === 'cloud' && mutationResource(dependency.intent.action) === mutationResource(entry.intent.action))) {
            return undefined;
          }
        }
        const base = operationBase(entry.intent);
        let predecessor: z.infer<typeof mutationReceipt> | undefined;
        if (base?.kind === 'operation') {
          const result = acceptedResult(base.operationId, index, superseded);
          if (!result || result === 'cloud') return undefined;
          predecessor = result;
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
