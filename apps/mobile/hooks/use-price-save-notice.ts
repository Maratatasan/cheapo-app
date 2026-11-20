import { useEffect, useState } from 'react';

import type { PriceSaveStatus } from '@/data/pending-price-sync';
import type { PhotoSavePending } from '@/data/price-records';
import type { CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';

const notice: Record<PriceSaveStatus, string> = {
  waiting: 'Saved on this phone · Waiting to sync',
  failed: 'Saved on this phone · Could not sync',
  synced: 'Synced to Cheapo',
  'photo-pending': 'Price synced · Photo pending',
  'photo-failed': 'Price synced · Could not sync the photo',
  'needs-shop': 'Saved on this phone · Needs shop',
  recovery: 'Saved on this phone · Held for recovery',
};

export function usePriceSaveNotice(shopping: CheapoShoppingRuntime | null, sourceId?: string, initialPending?: PhotoSavePending) {
  const [saved, setSaved] = useState<{ shopping: CheapoShoppingRuntime; sourceId: string; status: PriceSaveStatus }>();

  useEffect(() => {
    if (!shopping || !sourceId) return;
    let active = true;
    let revision = 0;
    async function refresh(current: CheapoShoppingRuntime, id: string) {
      const request = ++revision;
      const status = await current.readPriceSaveStatus(id).catch(() => undefined);
      if (active && request === revision && status) setSaved({ shopping: current, sourceId: id, status });
    }
    const unsubscribe = shopping.subscribeSync(() => { void refresh(shopping, sourceId); });
    void refresh(shopping, sourceId);
    return () => { active = false; unsubscribe(); };
  }, [shopping, sourceId]);

  if (!shopping || !sourceId) return undefined;
  const status = saved?.shopping === shopping && saved.sourceId === sourceId ? saved.status : initialPending;
  return status ? notice[status] : undefined;
}
