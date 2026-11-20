import {
  type ManualPriceRecord, loadSavedPriceRecord, loadSavedPriceRecords, saveManualPrice,
} from './local-photo';
import type { PriceAppendQueue } from './price-append-queue';

export function createPriceRecords(queue: PriceAppendQueue | null) {
  return {
    async saveManual(record: ManualPriceRecord) {
      if (!queue) return saveManualPrice(record);
      if (await loadSavedPriceRecord(record.id)) throw Error('A price with this ID is already saved.');
      // The queue entry is the durable price record for this enrolled save.
      // The previous local store remains the source for pre-enrollment records.
      await queue.save(record);
      return record;
    },
    async load(id: string) {
      if (queue) {
        const { entries } = await queue.read();
        const price = entries.find(entry => entry.record.id === id);
        if (price) return price.record;
      }
      return loadSavedPriceRecord(id);
    },
    async loadAll({ requireAll = false } = {}) {
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
    },
  };
}
