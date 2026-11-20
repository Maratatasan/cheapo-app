import { normalizeName } from '@cheapo/domain/names';
import type { PriceObservation } from '@cheapo/domain/price-history';

import type { SavedPriceRecord } from './local-photo';
import { reviewComplete } from './photo-review';
import type { PriceAppendReceipt } from './price-append-queue';
import { comparisonRowFromDraft } from './saved-comparison';

type LegacyHistoryRow = { source: 'legacy'; key: string; record: SavedPriceRecord };
type QueuedHistoryRow = { source: 'queued'; key: string; record: SavedPriceRecord; receipt?: PriceAppendReceipt };
type LocalHistoryRow = LegacyHistoryRow | QueuedHistoryRow;
type SharedHistoryRow = { source: 'shared'; key: string; observation: PriceObservation; linkedLocal?: LocalHistoryRow };
export type SavedPriceHistoryRow = LocalHistoryRow | SharedHistoryRow;

// The caller supplies queue entries and observations from the same verified
// phone owner. The preserved local link is useful for local evidence and edits.
export function savedPriceHistoryRows({ legacy, queued, shared }: {
  legacy: readonly SavedPriceRecord[];
  queued: ReadonlyArray<{ record: SavedPriceRecord; receipt?: PriceAppendReceipt }>;
  shared: readonly PriceObservation[];
}): SavedPriceHistoryRow[] {
  const sharedById = new Map<string, SharedHistoryRow>();
  for (const observation of shared) {
    const existing = sharedById.get(observation.id);
    if (!existing || observation.version > existing.observation.version) {
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

export function comparisonRowFromSavedHistory(row: SavedPriceHistoryRow) {
  if (row.source !== 'shared') {
    const comparison = comparisonRowFromDraft(row.record);
    return comparison ? { ...comparison, id: row.key } : null;
  }

  const observation = row.observation;
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
    currency: observation.currency,
    unit_price: observation.unitPrice,
  };
}
