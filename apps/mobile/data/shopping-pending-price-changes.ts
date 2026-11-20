import type { PriceAppendQueue } from './price-append-queue';
import type { QueuedShoppingMutation, ShoppingMutationQueue } from './shopping-mutation-queue';
import type { ShoppingMutation } from './shopping-mutations';

type PriceAction = Extract<ShoppingMutation['action'], { kind: 'price' }>;
export type PendingPriceChange = {
  operationId: string;
  title: string;
  sourceId?: string;
  resourceId?: string;
  change: PriceAction['change'];
} & ({ state: 'waiting' | 'failed' | 'conflict' | 'recovery' }
  | { state: 'acknowledged'; acceptedVersion: number });

export function priceChangeIsNewerThan(change: PendingPriceChange, observedVersion: number | undefined) {
  return change.state !== 'acknowledged' || observedVersion === undefined || observedVersion < change.acceptedVersion;
}

function originalEdit(entry: QueuedShoppingMutation, index: ReadonlyMap<string, QueuedShoppingMutation>) {
  let original = entry;
  const visited = new Set<string>();
  while (original.resolves && !visited.has(original.resolves)) {
    visited.add(original.resolves);
    const earlier = index.get(original.resolves);
    if (!earlier) break;
    original = earlier;
  }
  return original.intent;
}

function existingPriceId(entry: QueuedShoppingMutation, index: ReadonlyMap<string, QueuedShoppingMutation>) {
  let current: QueuedShoppingMutation | undefined = entry;
  const visited = new Set<string>();
  while (current && !visited.has(current.intent.operationId)) {
    const intent: ShoppingMutation = current.intent;
    visited.add(intent.operationId);
    if (intent.action.kind !== 'price') break;
    const base: PriceAction['base'] = intent.action.base;
    if (base.kind === 'version') return base.id;
    if (current.request) return current.request.path.split('/').at(-1);
    current = base.kind === 'operation' ? index.get(base.operationId) : undefined;
  }
}

export async function readPriceChangeOverlay(prices: PriceAppendQueue, mutations: ShoppingMutationQueue) {
  const [{ entries: observations }, { entries, recovery }] = await Promise.all([prices.read(), mutations.read()]);
  const index = new Map(entries.map(entry => [entry.intent.operationId, entry]));
  const records = new Map(observations.map(entry => [entry.record.id, entry.receipt]));
  const unreadable = new Set(recovery.filter(({ reason }) => reason === 'unreadable').map(({ operationId }) => operationId));
  const pending: { choice: PendingPriceChange; order: ShoppingMutation }[] = [];
  for (const entry of entries) {
    const { intent, outcome, resolution, superseded, failure } = entry;
    const { action, operationId, title } = intent;
    if (action.kind !== 'price' || resolution || superseded) continue;
    const existingId = existingPriceId(entry, index);
    const localReceipt = records.get(action.priceKey);
    const provenLocal = records.has(action.priceKey) && (!existingId || localReceipt?.id === existingId);
    const sourceId = action.base.kind === 'append' ? action.base.sourceId : provenLocal ? action.priceKey : undefined;
    const resourceId = existingId ?? (sourceId ? records.get(sourceId)?.id : undefined);
    if (!sourceId && !resourceId) continue;
    const change = { operationId, title, sourceId, resourceId, change: action.change };
    const order = originalEdit(entry, index);
    if (outcome?.kind === 'applied') {
      if (typeof outcome.receipt.version === 'number') {
        pending.push({ choice: { ...change, state: 'acknowledged', acceptedVersion: outcome.receipt.version }, order });
      }
      continue;
    }
    const state = unreadable.has(operationId) ? 'recovery' : outcome?.kind === 'conflict' ? 'conflict' : failure ? 'failed' : 'waiting';
    pending.push({ choice: { ...change, state }, order });
  }
  pending.sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt) || a.order.operationId.localeCompare(b.order.operationId));
  const byOriginalId = new Map(pending.map(item => [item.order.operationId, item]));
  const ordered: PendingPriceChange[] = [];
  const visited = new Set<string>();
  function add(item: (typeof pending)[number]) {
    const { operationId, action } = item.order;
    if (visited.has(operationId)) return;
    visited.add(operationId);
    if (action.kind === 'price' && action.base.kind === 'operation') {
      const previous = index.get(action.base.operationId);
      const dependency = previous && byOriginalId.get(originalEdit(previous, index).operationId);
      if (dependency) add(dependency);
    }
    ordered.push(item.choice);
  }
  pending.forEach(add);
  return ordered;
}
