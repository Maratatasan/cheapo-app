import { openCheapoSavedPriceReads } from './cheapo-shopping-read-device';
import { readEnrolledPriceEdit, recordFromObservation, type PriceEditRecord, type PriceEditTarget } from './edit-enrolled-price';
import type { ManualReview } from './photo-review';
import type { PhotoSavePending } from './price-records';
import type { CheapoShoppingRuntime } from './shopping-sync-runtime';

export async function readOwnEnrolledPriceEdit(runtime: CheapoShoppingRuntime, record: PriceEditRecord, signal?: AbortSignal) {
  const phone = await readEnrolledPriceEdit(runtime, record);
  if (phone.target) return { ...phone, available: true };
  const reads = await openCheapoSavedPriceReads(runtime.owner);
  const source = await reads.loadPriceHistory({ sourceId: record.id, includeRecordedInError: true }, signal);
  reads.assertCurrent();
  if (source.status === 'unavailable') return { ...phone, available: false };
  const matched = source.value.observations.find(item => item.sourceId === record.id && item.ownedByCurrentShopper);
  if (!matched) return { ...phone, available: source.status === 'fresh' && source.value.observations.length === 0 };
  const detail = await reads.loadPriceObservation(matched.id, signal);
  reads.assertCurrent();
  if (detail.status === 'unavailable' || !detail.value.observation?.ownedByCurrentShopper
    || detail.value.observation.sourceId !== record.id) return { ...phone, available: false };
  const observation = detail.value.observation;
  const reviewed = await readEnrolledPriceEdit(runtime, { ...recordFromObservation(observation), id: record.id,
    original: record.original, selected: record.selected }, observation);
  reads.assertCurrent();
  return { ...reviewed, available: true };
}

export async function firstSyncSavedPrice(runtime: CheapoShoppingRuntime, record: PriceEditRecord & { review: ManualReview }) {
  const { id, capturedAt, original, selected, cropBox, productId, shop, review } = record;
  await runtime.assertOwner();
  let pending: PhotoSavePending = 'waiting';
  if (original && selected) {
    const saved = await runtime.priceRecords.saveNewPhoto({ id, capturedAt, original, selected, cropBox, productId, shop, review });
    if (!saved.pending) throw Error('Complete the price details before saving this price to Cheapo.');
    pending = saved.pending;
  } else if (shop && productId) {
    await runtime.priceQueue.save({ id, capturedAt, productId, shop, review });
  } else {
    throw Error('Check the saved shop and product before syncing this price.');
  }
  await runtime.assertOwner();
  if (pending === 'waiting') void runtime.retry().catch(() => { /* The durable price remains pending. */ });
  const target: PriceEditTarget = { priceKey: id, base: { kind: 'append', sourceId: id } };
  return { target, pending };
}
