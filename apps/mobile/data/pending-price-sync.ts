import type { PriceAppendQueue } from './price-append-queue';

type PendingPriceState = 'waiting' | 'failed' | 'photo-pending' | 'photo-failed' | 'needs-shop' | 'recovery';
export type PendingPriceItem = { id: string; sourceId: string; title: string; state: PendingPriceState };
export type PriceSaveStatus = PendingPriceState | 'synced';

async function pendingPriceItems(queue: PriceAppendQueue, { entries, recovery }: Awaited<ReturnType<PriceAppendQueue['read']>>): Promise<PendingPriceItem[]> {
  const rows: PendingPriceItem[] = [];
  const recoveredIds = new Set(recovery.map(({ sourceId }) => sourceId));
  const unreadableIds = new Set(recovery.filter(({ reason }) => reason === 'unreadable').map(({ sourceId }) => sourceId));
  const titleById = new Map(entries.map(({ record }) => [record.id, record.review?.productName ?? 'Saved price']));
  for (const { record, body, receipt, needsShop } of entries) {
    const sourceId = record.id;
    const title = record.review?.productName ?? 'Saved price';
    if (unreadableIds.has(sourceId)) continue;
    if (needsShop) {
      rows.push({ id: `price:${sourceId}`, sourceId, title, state: 'needs-shop' });
      recoveredIds.delete(sourceId);
    } else if (body && !receipt) {
      const state = queue.hasFailed(sourceId, 'price') ? 'failed' : 'waiting';
      rows.push({ id: `price:${sourceId}`, sourceId, title, state });
      recoveredIds.delete(sourceId);
    } else if (receipt && record.original) {
      try {
        const photos = await queue.evidence.load({ record, receipt });
        if (!photos || photos.length) {
          const state = queue.hasFailed(sourceId, 'photo') ? 'photo-failed' : 'photo-pending';
          rows.push({ id: `photo:${sourceId}`, sourceId, title, state });
          recoveredIds.delete(sourceId);
        }
      } catch {
        recoveredIds.add(sourceId);
      }
    }
  }
  for (const sourceId of recoveredIds) {
    rows.push({ id: `recovery:${sourceId}`, sourceId, title: titleById.get(sourceId) ?? 'Saved price', state: 'recovery' });
  }
  return rows;
}

export async function readPendingPrices(queue: PriceAppendQueue) {
  return pendingPriceItems(queue, await queue.read());
}

export async function readPriceSaveStatus(queue: PriceAppendQueue, sourceId: string): Promise<PriceSaveStatus | undefined> {
  const { entries, recovery } = await queue.read();
  const matching = entries.filter(({ record }) => record.id === sourceId);
  const pending = await pendingPriceItems(queue, { entries: matching, recovery: recovery.filter(entry => entry.sourceId === sourceId) });
  return pending[0]?.state ?? (matching.some(({ receipt }) => receipt) ? 'synced' : undefined);
}
