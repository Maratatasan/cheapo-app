import {
  type LocalPhotoDraft, type ManualPriceRecord, loadSavedPriceRecord, loadSavedPriceRecords, saveLocalPhoto, saveManualPrice,
} from './local-photo';
import type { PriceAppendQueue } from './price-append-queue';
import { reviewComplete } from './photo-review';

export type PhotoSavePending = 'waiting' | 'needs-shop';

export function createPriceRecords(queue: PriceAppendQueue | null) {
  async function loadAll({ requireAll = false } = {}) {
    const local = await loadSavedPriceRecords({ requireAll });
    if (!queue) return local;
    const { entries, recovery } = await queue.read();
    const enrolled = new Map(entries.map(({ record }) => [record.id, record]));
    if (requireAll && recovery.some(entry => entry.reason === 'unreadable' && !enrolled.has(entry.sourceId))) {
      throw Error('A saved price is unreadable. Cheapo could not export the full collection.');
    }
    for (const record of local) {
      if (!enrolled.has(record.id)) enrolled.set(record.id, record);
    }
    return [...enrolled.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  }

  return {
    async saveManual(record: ManualPriceRecord) {
      if (!queue) return saveManualPrice(record);
      if (await loadSavedPriceRecord(record.id)) throw Error('A price with this ID is already saved.');
      // The queue entry is the durable price record for this enrolled save.
      // The previous local store remains the source for pre-enrollment records.
      await queue.save(record);
      return record;
    },
    async saveNewPhoto(draft: LocalPhotoDraft) {
      if (!queue || !reviewComplete(draft.review, draft.shop?.displayName)) {
        return { record: await saveLocalPhoto(draft), pending: undefined };
      }
      const pending: PhotoSavePending = draft.shop ? 'waiting' : 'needs-shop';
      const record = await saveLocalPhoto(draft, saved => saved.shop ? queue.save(saved) : queue.saveNeedsShop(saved));
      return { record, pending };
    },
    async load(id: string) {
      if (queue) {
        const { entries } = await queue.read();
        const price = entries.find(entry => entry.record.id === id);
        if (price) return price.record;
      }
      return loadSavedPriceRecord(id);
    },
    loadAll,
    async loadPhotos() {
      return (await loadAll()).filter((record): record is LocalPhotoDraft => Boolean(record.original));
    },
  };
}
