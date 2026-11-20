import { priceAppendSchema } from '@cheapo/domain/price-append';
import { packagePriceBases } from '@cheapo/domain/package-measures';
import { z } from 'zod';

import { CheapoAccessError, type CheapoAccess } from '../lib/cheapo-access/client';
import { readPendingPrices, type PendingPriceItem } from './pending-price-sync';
import { openPriceAppendQueue, sameShoppingOwner, type PriceAppendQueue } from './price-append-queue';
import { createPriceAppendSync } from './price-append-sync';
import { createPriceEvidenceSync } from './price-evidence-sync';
import { createPriceRecords } from './price-records';
import { openShoppingMutationQueue, type ShoppingMutationQueue } from './shopping-mutation-queue';
import { decodeMutationAcknowledgement, mutationVersion, type MutationRequest, type ShoppingMutation } from './shopping-mutations';
import { readPriceChangeOverlay } from './shopping-pending-price-changes';
import { readShoppingWriteReply } from './shopping-write-reply';

type SyncAccess = Pick<CheapoAccess, 'lastVerifiedOwner' | 'openShoppingWriteSession'>;
type OpenSession = CheapoAccess['openShoppingWriteSession'];
type MutationTrouble = { id: string; operationId: string; title: string; state: 'waiting' | 'failed' | 'conflict' | 'recovery' };
export type PendingShoppingChange = PendingPriceItem | MutationTrouble;
type SyncSnapshot = { state: 'complete' | 'blocked' | 'pending'; items: PendingShoppingChange[] };

const knownBasis = z.enum(packagePriceBases).nullable();

function readConflict(intent: ShoppingMutation, request: MutationRequest, value: unknown) {
  if (!value || typeof value !== 'object' || !('error' in value) || value.error !== 'version_conflict'
    || !('currentVersion' in value) || !('current' in value)) return;
  const version = mutationVersion.safeParse(value.currentVersion);
  const current = z.json().safeParse(value.current);
  if (!version.success || !current.success || !current.data || typeof current.data !== 'object' || Array.isArray(current.data)) return;
  const action = intent.action;
  const snapshot = current.data;
  const currentVersion = version.data;
  const result = { kind: 'conflict' as const, currentVersion, current: snapshot };
  switch (action.kind) {
    case 'price':
      if (typeof currentVersion === 'number' && currentVersion > 0 && snapshot.id === request.path.split('/').at(-1)
        && snapshot.version === currentVersion) return result;
      break;
    case 'edit-product':
      if (typeof currentVersion === 'number' && currentVersion > 0 && snapshot.id === action.product.id) return result;
      break;
    case 'edit-shop':
    case 'unlink-shop':
      if (typeof currentVersion === 'string' && snapshot.id === action.shopId) return result;
      break;
    case 'preference':
      if (typeof currentVersion === 'number' && knownBasis.safeParse(snapshot.basis).success) return result;
      break;
  }
}

async function flushShoppingChanges(
  mutations: ShoppingMutationQueue, prices: PriceAppendQueue, openSession: OpenSession, attempted: Set<string>,
) {
  const receipts = new Map((await prices.read()).entries.map(({ record, receipt }) => [record.id, receipt]));
  const loadAppendReceipt = async (sourceId: string) => receipts.get(sourceId);
  let progressed: boolean;
  do {
    progressed = false;
    const { entries, recovery } = await mutations.read();
    const unreadable = new Set(recovery.filter(({ reason }) => reason === 'unreadable').map(({ operationId }) => operationId));
    for (const { intent, outcome, superseded } of entries) {
      const { operationId } = intent;
      if (outcome || superseded || attempted.has(operationId) || unreadable.has(operationId)) continue;
      let request;
      try { request = await mutations.freeze(operationId, loadAppendReceipt); } catch { continue; }
      if (!request) continue;
      attempted.add(operationId);
      try {
        const session = await openSession();
        const { status, body } = await readShoppingWriteReply(session.request, request.path, {
          method: request.method, body: request.body,
          ...(request.body ? { headers: { 'Content-Type': 'application/json' } } : {}),
        }, code => code === 200 || code === 201 || code === 409);
        session.assertCurrent();
        if (status === 401 || status === 403) return 'blocked';
        const conflict = status === 409 ? readConflict(intent, request, body) : undefined;
        if (conflict) {
          await mutations.settle(operationId, conflict);
          continue;
        }
        const receipt = status === 200 || status === 201 ? decodeMutationAcknowledgement(intent, request, body) : undefined;
        if (receipt) {
          await mutations.settle(operationId, { kind: 'applied', receipt });
          progressed = true;
          continue;
        }
      } catch (error) {
        if (error instanceof CheapoAccessError) return 'blocked';
      }
      await mutations.fail(operationId, 'service').catch(() => {});
    }
  } while (progressed);
  return 'checked';
}

async function appendEligibility(queue: ShoppingMutationQueue) {
  const { entries } = await queue.read();
  const shops = new Set<string>();
  const products = new Set<string>();
  for (const { intent: { action }, outcome, superseded } of entries) {
    if (outcome?.kind === 'applied' || superseded) continue;
    if (action.kind === 'save-shop') shops.add(action.shop.id);
    if (action.kind === 'create-product') products.add(action.product.id);
  }
  return (body: string) => {
    const { shopId, productId } = priceAppendSchema.parse(JSON.parse(body));
    return !shops.has(shopId) && (!productId || !products.has(productId));
  };
}

async function readPendingChanges(prices: PriceAppendQueue, mutations: ShoppingMutationQueue): Promise<PendingShoppingChange[]> {
  const [priceItems, { entries, recovery }] = await Promise.all([readPendingPrices(prices), mutations.read()]);
  const recoveryIds = new Set(recovery.map(({ operationId }) => operationId));
  const unreadable = new Set(recovery.filter(({ reason }) => reason === 'unreadable').map(({ operationId }) => operationId));
  const labels = new Map(entries.map(({ intent }) => [intent.operationId, intent.title]));
  const mutationItems: MutationTrouble[] = [];
  for (const { intent, outcome, failure, resolution, superseded } of entries) {
    const { operationId, title } = intent;
    if (resolution || superseded || outcome?.kind === 'applied' || unreadable.has(operationId)) continue;
    const state = outcome?.kind === 'conflict' ? 'conflict' : failure ? 'failed' : 'waiting';
    mutationItems.push({ id: `mutation:${operationId}`, operationId, title, state });
    recoveryIds.delete(operationId);
  }
  for (const operationId of recoveryIds) {
    mutationItems.push({ id: `recovery-mutation:${operationId}`, operationId, title: labels.get(operationId) ?? 'Shopping change', state: 'recovery' });
  }
  return [...priceItems, ...mutationItems];
}

export function createShoppingSync(access: SyncAccess, priceQueue: PriceAppendQueue, mutationQueue: ShoppingMutationQueue) {
  const { owner } = priceQueue;
  if (!sameShoppingOwner(mutationQueue.owner, owner)) throw Error('Cheapo shopping queues use different owners.');

  async function assertOwner() {
    if (!sameShoppingOwner(await access.lastVerifiedOwner(), owner)) throw new CheapoAccessError('Cheapo access changed. Reopen shopping.');
  }

  async function readPending() {
    await assertOwner();
    const items = await readPendingChanges(priceQueue, mutationQueue);
    await assertOwner();
    return items;
  }

  async function loadPriceChanges() {
    await assertOwner();
    const changes = await readPriceChangeOverlay(priceQueue, mutationQueue);
    await assertOwner();
    return changes;
  }

  async function synchronize(): Promise<SyncSnapshot> {
    await assertOwner();
    let capturedSession: ReturnType<OpenSession> | undefined;
    const openSession: OpenSession = () => capturedSession ??= access.openShoppingWriteSession().then(session => {
      if (!sameShoppingOwner(session.owner, owner)) throw new CheapoAccessError('Cheapo access changed. Reopen shopping.');
      return session;
    });
    const attempted = new Set<string>();
    let blocked = await flushShoppingChanges(mutationQueue, priceQueue, openSession, attempted) === 'blocked';
    if (!blocked) {
      const canSend = await appendEligibility(mutationQueue);
      blocked = await createPriceAppendSync(priceQueue, openSession, canSend)() === 'blocked';
    }
    if (!blocked) blocked = await flushShoppingChanges(mutationQueue, priceQueue, openSession, attempted) === 'blocked';
    if (!blocked) blocked = await createPriceEvidenceSync(priceQueue, openSession)() === 'blocked';
    const items = await readPending();
    return { state: blocked ? 'blocked' : items.length ? 'pending' : 'complete', items };
  }

  let active: Promise<SyncSnapshot> | undefined;
  let requested = false;
  return {
    readPending,
    loadPriceChanges,
    retry() {
      requested = true;
      if (!active) {
        active = Promise.resolve().then(async () => {
          try {
            let snapshot: SyncSnapshot = { state: 'pending', items: [] };
            while (requested) {
              requested = false;
              snapshot = await synchronize();
            }
            return snapshot;
          } finally {
            active = undefined;
          }
        });
      }
      return active;
    },
  };
}

export async function openCheapoShopping(access: SyncAccess) {
  const owner = await access.lastVerifiedOwner();
  if (!owner) return null;
  const [priceQueue, mutationQueue] = await Promise.all([openPriceAppendQueue(owner), openShoppingMutationQueue(owner)]);
  if (!sameShoppingOwner(await access.lastVerifiedOwner(), owner)) return null;
  return { owner, priceQueue, mutationQueue, priceRecords: createPriceRecords(priceQueue), ...createShoppingSync(access, priceQueue, mutationQueue) };
}

export type CheapoShoppingRuntime = NonNullable<Awaited<ReturnType<typeof openCheapoShopping>>>;
