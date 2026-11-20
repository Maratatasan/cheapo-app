import { priceAppendSchema } from '@cheapo/domain/price-append';
import { packagePriceBases } from '@cheapo/domain/package-measures';
import { z } from 'zod';

import { CheapoAccessError, type CheapoAccess } from '../lib/cheapo-access/client';
import type { DraftShop } from './local-photo';
import { readPendingPrices, readPriceSaveStatus, type PendingPriceItem, type PriceSaveStatus } from './pending-price-sync';
import { openPriceAppendQueue, sameShoppingOwner, type PriceAppendQueue } from './price-append-queue';
import { createPriceAppendSync } from './price-append-sync';
import { createPriceEvidenceSync } from './price-evidence-sync';
import { createPriceRecords } from './price-records';
import { createProductPricePromotion } from './product-price-promotion';
import { openShoppingMutationQueue, rejectedBarcodeProductIds, type ShoppingMutationQueue } from './shopping-mutation-queue';
import { decodeMutationAcknowledgement, existingBarcodeProduct, matchesCompetingBarcode, mutationVersion, type MutationRequest, type ShoppingMutation, type ShoppingMutationInput } from './shopping-mutations';
import { readPriceChangeOverlay } from './shopping-pending-price-changes';
import { readShoppingWriteReply } from './shopping-write-reply';

type SyncAccess = Pick<CheapoAccess, 'lastVerifiedOwner' | 'openShoppingWriteSession'>;
type OpenSession = CheapoAccess['openShoppingWriteSession'];
type MutationTrouble = { id: string; operationId: string; title: string; state: 'waiting' | 'failed' | 'conflict' | 'needs-product-review' | 'recovery' };
export type PendingShoppingChange = PendingPriceItem | MutationTrouble;
type SyncSnapshot = { state: 'complete' | 'blocked' | 'pending'; items: PendingShoppingChange[] };

const knownBasis = z.enum(packagePriceBases).nullable();

function readConflict(intent: ShoppingMutation, request: MutationRequest, value: unknown) {
  if (!value || typeof value !== 'object' || !('error' in value)) return;
  if (value.error === 'product_conflict' && 'product' in value) {
    const checked = existingBarcodeProduct.safeParse(value.product);
    if (checked.success && matchesCompetingBarcode(intent.action, checked.data)) return { kind: 'product-match' as const, product: checked.data };
  }
  if (value.error !== 'version_conflict'
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
  onApplied: (kind: ShoppingMutation['action']['kind']) => void,
) {
  const receipts = new Map((await prices.read()).entries.map(({ record, receipt }) => [record.id, receipt]));
  const loadAppendReceipt = async (sourceId: string) => receipts.get(sourceId);
  let progressed: boolean;
  do {
    progressed = false;
    const { entries, recovery } = await mutations.read();
    const rejectedProducts = rejectedBarcodeProductIds(entries);
    const unreadable = new Set(recovery.filter(({ reason }) => reason === 'unreadable').map(({ operationId }) => operationId));
    for (const { intent, outcome, superseded } of entries) {
      const { operationId, action } = intent;
      if (outcome || superseded || attempted.has(operationId) || unreadable.has(operationId)) continue;
      if (action.kind === 'edit-product' && rejectedProducts.has(action.product.id)) continue;
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
          if (conflict.kind === 'product-match' && action.kind === 'create-product') rejectedProducts.add(action.product.id);
          continue;
        }
        const receipt = status === 200 || status === 201 ? decodeMutationAcknowledgement(intent, request, body) : undefined;
        if (receipt) {
          await mutations.settle(operationId, { kind: 'applied', receipt });
          onApplied(intent.action.kind);
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

async function preparePriceAppend(queue: ShoppingMutationQueue) {
  const { entries } = await queue.read();
  const shops = new Set<string>();
  const products = new Set<string>();
  const replacements = new Map<string, string>();
  for (const { intent: { action }, outcome, resolution, superseded } of entries) {
    if (outcome?.kind === 'applied' || superseded) continue;
    if (action.kind === 'save-shop') shops.add(action.shop.id);
    if (action.kind === 'create-product') {
      if (outcome?.kind === 'product-match' && resolution?.kind === 'use-existing-product') {
        const previous = replacements.get(action.product.id);
        if (previous && previous !== resolution.productId) products.add(action.product.id);
        else replacements.set(action.product.id, resolution.productId);
      } else products.add(action.product.id);
    }
  }
  return (body: string) => {
    const price = priceAppendSchema.parse(JSON.parse(body));
    if (shops.has(price.shopId) || (price.productId && products.has(price.productId))) return;
    const replacement = price.productId && replacements.get(price.productId);
    return replacement ? JSON.stringify({ ...price, productId: replacement }) : body;
  };
}

async function readPendingChanges(prices: PriceAppendQueue, mutations: ShoppingMutationQueue): Promise<PendingShoppingChange[]> {
  const [priceItems, { entries, recovery }] = await Promise.all([readPendingPrices(prices), mutations.read()]);
  const recoveryIds = new Set(recovery.map(({ operationId }) => operationId));
  const unreadable = new Set(recovery.filter(({ reason }) => reason === 'unreadable').map(({ operationId }) => operationId));
  const labels = new Map(entries.map(({ intent }) => [intent.operationId, intent.title]));
  const rejectedProducts = rejectedBarcodeProductIds(entries);
  const mutationItems: MutationTrouble[] = [];
  for (const { intent, outcome, failure, resolution, superseded } of entries) {
    const { operationId, title, action } = intent;
    if (resolution || superseded || outcome?.kind === 'applied' || unreadable.has(operationId)) continue;
    const heldProductEdit = action.kind === 'edit-product' && rejectedProducts.has(action.product.id);
    const state = outcome?.kind === 'product-match' ? 'needs-product-review'
      : outcome?.kind === 'conflict' ? 'conflict' : heldProductEdit ? 'recovery' : failure ? 'failed' : 'waiting';
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
  const productPrices = createProductPricePromotion(priceQueue, mutationQueue, assertOwner);

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

  async function readPriceCorrectionStatus(operationId: string): Promise<PriceSaveStatus | undefined> {
    const { entries, recovery } = await mutationQueue.read();
    const visited = new Set<string>();
    let id = operationId;
    while (!visited.has(id)) {
      visited.add(id);
      if (recovery.some(item => item.operationId === id && item.reason === 'unreadable')) return 'recovery';
      const entry = entries.find(({ intent }) => intent.operationId === id);
      if (!entry || entry.intent.action.kind !== 'price') return undefined;
      if (entry.superseded) return 'recovery';
      if (entry.resolution?.kind === 'keep-cloud') return 'cloud';
      if (entry.resolution?.kind === 'keep-phone') { id = entry.resolution.replacementId; continue; }
      if (entry.outcome?.kind === 'applied') return 'synced';
      if (entry.outcome?.kind === 'conflict') return 'conflict';
      return entry.failure ? 'failed' : 'waiting';
    }
    return 'recovery';
  }

  async function synchronize(onApplied: (kind: ShoppingMutation['action']['kind']) => void): Promise<SyncSnapshot> {
    await assertOwner();
    await productPrices.recover();
    let capturedSession: ReturnType<OpenSession> | undefined;
    const openSession: OpenSession = () => capturedSession ??= access.openShoppingWriteSession().then(session => {
      if (!sameShoppingOwner(session.owner, owner)) throw new CheapoAccessError('Cheapo access changed. Reopen shopping.');
      return session;
    });
    const attempted = new Set<string>();
    let blocked = await flushShoppingChanges(mutationQueue, priceQueue, openSession, attempted, onApplied) === 'blocked';
    if (!blocked) {
      const prepareBody = await preparePriceAppend(mutationQueue);
      blocked = await createPriceAppendSync(priceQueue, openSession, prepareBody)() === 'blocked';
    }
    if (!blocked) blocked = await flushShoppingChanges(mutationQueue, priceQueue, openSession, attempted, onApplied) === 'blocked';
    if (!blocked) blocked = await createPriceEvidenceSync(priceQueue, openSession)() === 'blocked';
    const items = await readPending();
    return { state: blocked ? 'blocked' : items.length ? 'pending' : 'complete', items };
  }

  let active: Promise<SyncSnapshot> | undefined;
  let requested = false;
  const listeners = new Set<(snapshot: SyncSnapshot | undefined, updated: ReadonlySet<ShoppingMutation['action']['kind']>) => void>();
  return {
    assertOwner,
    productPrices: { stage: productPrices.stage, pendingDrafts: productPrices.pendingDrafts, confirm: productPrices.confirm },
    async commitMutation(intent: ShoppingMutationInput) {
      await assertOwner();
      await mutationQueue.enqueue(intent);
      await assertOwner();
    },
    async confirmPriceShop(sourceId: string, shop: DraftShop) {
      await assertOwner();
      await priceQueue.confirmShop(sourceId, shop);
      await assertOwner();
    },
    async resolveConflict(operationId: string, choice: Parameters<ShoppingMutationQueue['resolve']>[1]) {
      await assertOwner();
      await mutationQueue.resolve(operationId, choice);
      await assertOwner();
    },
    async useExistingProduct(operationId: string, productId: string) {
      await assertOwner();
      await mutationQueue.useExistingProduct(operationId, productId);
      await assertOwner();
    },
    readPending,
    loadPriceChanges,
    async readPriceSaveStatus(sourceId: string, operationId?: string) {
      await assertOwner();
      const status = await (operationId ? readPriceCorrectionStatus(operationId) : readPriceSaveStatus(priceQueue, sourceId));
      await assertOwner();
      return status;
    },
    subscribeSync(listener: (snapshot: SyncSnapshot | undefined, updated: ReadonlySet<ShoppingMutation['action']['kind']>) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    retry() {
      requested = true;
      if (!active) {
        active = Promise.resolve().then(async () => {
          let snapshot: SyncSnapshot = { state: 'pending', items: [] };
          let completed = false;
          const applied = new Set<ShoppingMutation['action']['kind']>();
          try {
            while (requested) {
              requested = false;
              try {
                snapshot = await synchronize(kind => { applied.add(kind); });
              } catch (error) {
                if (!requested) throw error;
              }
            }
            completed = true;
            return snapshot;
          } finally {
            active = undefined;
            if (completed || applied.size) {
              for (const listener of listeners) {
                try { listener(completed ? snapshot : undefined, applied); } catch { /* A view cannot change a durable receipt. */ }
              }
            }
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
