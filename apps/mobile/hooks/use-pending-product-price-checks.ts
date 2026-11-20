import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { checkProductIdentity, type ProductIdentityCheck } from '@/data/add-product-lookup';
import type { ProductPriceDraft } from '@/data/price-append-queue';
import type { CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';
import { useAddProductLookup } from './use-add-product-lookup';

export type PendingProductPriceCheck = { draft: ProductPriceDraft; check?: ProductIdentityCheck };
type DraftChecks = { status: 'loading' | 'unavailable' } | { status: 'ready'; rows: PendingProductPriceCheck[] };

export function usePendingProductPriceChecks(shopping: CheapoShoppingRuntime) {
  const lookup = useAddProductLookup();
  const [checks, setChecks] = useState<DraftChecks>({ status: 'loading' });
  const refresh = useRef<(() => void) | undefined>(undefined);

  useFocusEffect(useCallback(() => {
    let active: AbortController | undefined;

    async function reload() {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const { signal } = controller;
      let drafts: ProductPriceDraft[];
      try { drafts = await shopping.productPrices.pendingDrafts(); }
      catch { if (!signal.aborted) setChecks({ status: 'unavailable' }); return; }
      if (signal.aborted) return;
      setChecks({ status: 'ready', rows: drafts.map(draft => ({ draft })) });
      if (!lookup) return;

      for (const draft of drafts) {
        if (signal.aborted) return;
        const { record, barcode } = draft;
        if (!record.review) continue;
        const check = await checkProductIdentity(lookup, record.review, barcode ?? '', signal);
        if (signal.aborted) return;
        setChecks(current => current.status === 'ready' ? { status: 'ready',
          rows: current.rows.map(row => row.draft === draft ? { draft, check } : row) } : current);
      }
    }

    const recheck = () => { void reload().catch(() => { /* Losing focus cancels the read. */ }); };
    const unsubscribe = shopping.subscribeSync(result => { if (result) recheck(); });
    refresh.current = recheck;
    recheck();
    return () => { active?.abort(); unsubscribe(); refresh.current = undefined; };
  }, [lookup, shopping]));

  return { checks, reload: () => refresh.current?.() };
}
