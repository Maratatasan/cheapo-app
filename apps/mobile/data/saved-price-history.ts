import { normalizeName } from '@cheapo/domain/names';
import type { PriceObservation, PriceObservationDetail } from '@cheapo/domain/price-history';

import type { SavedPriceRecord } from './local-photo';
import { reviewComplete } from './photo-review';
import type { PriceAppendReceipt } from './price-append-queue';
import { comparisonRowFromDraft } from './saved-comparison';
import { priceChangeIsNewerThan, type PendingPriceChange } from './shopping-pending-price-changes';

type LegacyHistoryRow = { source: 'legacy'; key: string; record: SavedPriceRecord };
type QueuedHistoryRow = { source: 'queued'; key: string; record: SavedPriceRecord; receipt?: PriceAppendReceipt };
type LocalHistoryRow = LegacyHistoryRow | QueuedHistoryRow;
type SharedHistoryRow = { source: 'shared'; key: string; observation: PriceObservation; linkedLocal?: LocalHistoryRow };
export type SavedPriceHistoryRow = LocalHistoryRow | SharedHistoryRow;
export type PendingHistoryChange = PendingPriceChange;
export type PendingPriceState = Exclude<PendingPriceChange['state'], 'acknowledged'>;
const pendingPriority = { waiting: 0, failed: 1, recovery: 2, conflict: 3 } as const;

function strongestPending(current: PendingPriceState | undefined, next: PendingPriceState) {
  return !current || pendingPriority[next] > pendingPriority[current] ? next : current;
}

function appliesTo(change: PendingHistoryChange, row: SavedPriceHistoryRow) {
  if (row.source === 'legacy') return false;
  if (row.source === 'shared') {
    return change.resourceId ? change.resourceId === row.observation.id
      : row.observation.ownedByCurrentShopper && change.sourceId === row.observation.sourceId;
  }
  return change.resourceId ? change.resourceId === row.receipt?.id : change.sourceId === row.record.id;
}

function keptObservation(item: PendingHistoryChange) {
  if (item.state !== 'acknowledged' || item.change.action !== 'keep_cloud') return;
  const { observation } = item.change;
  if (item.resourceId === observation.id && item.acceptedVersion === observation.version) return observation;
}

export function keptSharedPrice(id: string, changes: readonly PendingHistoryChange[], version = 0) {
  let kept: PriceObservationDetail | undefined;
  for (const item of changes) {
    if (item.resourceId !== id) continue;
    const observation = keptObservation(item);
    if (observation && observation.version > (kept?.version ?? version)) kept = observation;
  }
  return kept;
}

export function projectSharedPrice<T extends PriceObservation>(observation: T, changes: readonly PendingHistoryChange[]) {
  const kept = keptSharedPrice(observation.id, changes, observation.version);
  let display = kept ? { ...observation, ...kept, recordedInErrorReason: kept.recordedInErrorReason } : observation;
  let pending: PendingPriceState | undefined;
  for (const item of changes) {
    if (item.change.action === 'keep_cloud') continue;
    if (!appliesTo(item, { source: 'shared', key: observation.id, observation }) || !priceChangeIsNewerThan(item, display.version)) continue;
    if (item.state !== 'acknowledged') pending = strongestPending(pending, item.state);
    const change = item.change;
    if (change.action === 'correct') {
      display = { ...display, productName: change.review.productName, review: change.review, priceAmount: change.review.price,
        currency: change.review.currency, unitPrice: change.unitPrice ?? null,
        productId: change.productId === undefined ? display.productId : change.productId,
        shopId: change.shop?.id ?? display.shopId, shopDisplayName: change.shop?.displayName ?? display.shopDisplayName };
      if (change.photoSelection && 'selectedPhotoRole' in display) {
        const selection = change.photoSelection;
        display = { ...display, cropSource: 'original',
          cropBox: selection.role === 'crop' ? selection.cropBox : null,
          selectedPhotoRole: display.photos.some(photo => photo.role === 'original') ? selection.role : null };
      }
    } else {
      display = { ...display, recordedInErrorReason: change.action === 'record_in_error' ? change.reason : undefined };
    }
  }
  return { display, pending };
}

export function projectLocalPrice(row: LocalHistoryRow, changes: readonly PendingHistoryChange[]) {
  let display = row.record;
  let productId: string | null | undefined = row.record.productId;
  let pending: PendingPriceState | undefined;
  let recordedInErrorReason: string | undefined;
  for (const item of changes) {
    if (item.change.action === 'keep_cloud') continue;
    if (!appliesTo(item, row) || !priceChangeIsNewerThan(item, row.source === 'queued' ? row.receipt?.version : undefined)) continue;
    if (item.state !== 'acknowledged') pending = strongestPending(pending, item.state);
    const change = item.change;
    if (change.action === 'correct') {
      if (change.productId !== undefined) productId = change.productId;
      const shop = change.shop ?? display.shop;
      if (shop) display = { ...display, shop, review: { ...change.review, shop: shop.displayName,
        unitPrice: change.review.unitPrice ?? '', unit: change.review.unit ?? '' } };
    } else {
      recordedInErrorReason = change.action === 'record_in_error' ? change.reason : undefined;
    }
  }
  return { display, pending, recordedInErrorReason, productId };
}

// The caller supplies queue entries and observations from the same verified
// phone owner. The preserved local link is useful for local evidence and edits.
export function savedPriceHistoryRows({ legacy, queued, shared, offlineChanges = [] }: {
  legacy: readonly SavedPriceRecord[];
  queued: ReadonlyArray<{ record: SavedPriceRecord; receipt?: PriceAppendReceipt }>;
  shared: readonly PriceObservation[];
  offlineChanges?: readonly PendingHistoryChange[];
}): SavedPriceHistoryRow[] {
  const sharedById = new Map<string, SharedHistoryRow>();
  for (const observation of shared) {
    const existing = sharedById.get(observation.id);
    if (!existing || observation.version > existing.observation.version) {
      sharedById.set(observation.id, { source: 'shared', key: `shared:${observation.id}`, observation });
    }
  }
  const cachedIds = new Set(sharedById.keys());
  for (const item of offlineChanges) {
    const observation = keptObservation(item);
    if (!observation || cachedIds.has(observation.id)) continue;
    const previous = sharedById.get(observation.id);
    if (!previous || observation.version > previous.observation.version) {
      sharedById.set(observation.id, { source: 'shared', key: `shared:${observation.id}`, observation });
    }
  }
  const ownedBySource = new Map<string, SharedHistoryRow>();
  for (const row of sharedById.values()) {
    if (row.observation.ownedByCurrentShopper) ownedBySource.set(row.observation.sourceId, row);
  }

  const unmatched: LocalHistoryRow[] = [];
  function place(local: LocalHistoryRow, match?: SharedHistoryRow) {
    if (match && !match.linkedLocal) match.linkedLocal = local;
    else unmatched.push(local);
  }

  for (const { record, receipt } of queued) {
    const row: QueuedHistoryRow = { source: 'queued', key: `queued:${record.id}`, record, receipt };
    const match = receipt
      ? (receipt.sourceId === record.id ? sharedById.get(receipt.id) : undefined)
      : ownedBySource.get(record.id);
    place(row, match);
  }
  for (const record of legacy) {
    const row: LegacyHistoryRow = { source: 'legacy', key: `legacy:${record.id}`, record };
    // Keep unfinished local captures separately accessible even if a known
    // shared observation has the same source ID.
    place(row, reviewComplete(record.review, record.shop?.displayName) ? ownedBySource.get(record.id) : undefined);
  }

  function timestamp(row: SavedPriceHistoryRow) {
    return Date.parse(row.source === 'shared' ? row.observation.capturedAt : row.record.capturedAt);
  }
  return [...sharedById.values(), ...unmatched].sort((a, b) => timestamp(b) - timestamp(a));
}

export function comparisonRowFromSavedHistory(row: SavedPriceHistoryRow, changes: readonly PendingHistoryChange[] = []) {
  if (row.source !== 'shared') {
    const { display, recordedInErrorReason, productId } = projectLocalPrice(row, changes);
    const comparison = recordedInErrorReason ? null : comparisonRowFromDraft(display);
    return comparison ? { ...comparison, id: row.key, productId } : null;
  }

  const { display: observation } = projectSharedPrice(row.observation, changes);
  if (observation.recordedInErrorReason || observation.priceAmount === null || !observation.currency) return null;
  const price = Number(observation.priceAmount);
  const product = normalizeName(observation.productName);
  const shop = normalizeName(observation.shopDisplayName);
  if (!Number.isFinite(price) || !product || !shop) return null;
  return {
    id: row.key,
    capturedOn: observation.capturedAt.slice(0, 10),
    product,
    shop,
    pack: normalizeName(observation.review?.packSize),
    productType: normalizeName(observation.review?.productType),
    variety: normalizeName(observation.review?.variety),
    brand: normalizeName(observation.review?.brand),
    price,
    productId: observation.productId,
    currency: observation.currency,
    unit_price: observation.unitPrice,
  };
}
