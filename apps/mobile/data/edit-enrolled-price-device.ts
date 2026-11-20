import { openCheapoSavedPriceReads } from './cheapo-shopping-read-device';
import { readEnrolledPriceEdit, recordFromObservation, type PriceEditRecord } from './edit-enrolled-price';
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
