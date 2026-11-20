import { Redirect, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';

import { CameraActionButton } from '@/component/camera-actions';
import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { PendingProductPriceReview } from '@/component/pending-product-price-review';
import { ui } from '@/component/results/theme';
import { checkProductIdentity, type AddProductLookup, type ProductIdentityCheck } from '@/data/add-product-lookup';
import type { ProductPriceChoice, ProductPriceDraft } from '@/data/price-append-queue';
import type { CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';
import { useAddProductLookup } from '@/hooks/use-add-product-lookup';

export default function ProductPriceDraftScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const shopping = useCheapoShopping();
  const lookup = useAddProductLookup();
  if (!shopping || !lookup || typeof id !== 'string' || Platform.OS === 'web') return <Redirect href="/pending-sync" />;
  return <DraftReview key={JSON.stringify([shopping.owner, id])} id={id} shopping={shopping} lookup={lookup} />;
}

function DraftReview({ id, shopping, lookup }: { id: string; shopping: CheapoShoppingRuntime; lookup: AddProductLookup }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProductPriceDraft | null>();
  const [check, setCheck] = useState<ProductIdentityCheck>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const saving = useRef(false);

  const reload = useCallback(() => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    const { signal } = controller;
    setCheck(undefined);
    setError(undefined);
    void (async () => {
      try {
        const saved = (await shopping.productPrices.pendingDrafts()).find(item => item.record.id === id);
        if (signal.aborted) return;
        setDraft(saved?.record.review && saved.record.shop ? saved : null);
        if (!saved?.record.review) return;
        const result = await checkProductIdentity(lookup, saved.record.review, saved.barcode ?? '', signal);
        if (!signal.aborted) setCheck(result);
      } catch {
        if (!signal.aborted) setDraft(null);
      }
    })();
  }, [id, lookup, shopping]);

  useFocusEffect(useCallback(() => {
    reload();
    return () => { active.current?.abort(); active.current = undefined; };
  }, [reload]));

  async function confirm(choice: ProductPriceChoice) {
    const signal = active.current?.signal;
    if (!signal || !draft || check?.kind !== 'checked' || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await shopping.productPrices.confirm(id, choice);
      if (!signal.aborted) router.back();
      void shopping.retry().catch(() => {});
    } catch {
      if (!signal.aborted) setError('Could not finish saving. Your draft is on this phone. Check Pending sync to continue.');
    } finally {
      saving.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  return <>
    <Stack.Screen options={{ title: 'Review product and price draft' }} />
    {draft ? <PendingProductPriceReview draft={draft} check={check} busy={busy} error={error}
      onRetry={reload} onBack={() => router.back()} onConfirm={choice => { void confirm(choice); }}
      onCompare={candidate => {
        if (candidate.kind === 'catalog') router.push({ pathname: '/find-product', params: { productId: candidate.product.id } });
        else router.push({ pathname: '/compare/[id]', params: { id: candidate.observationId, source: 'shared' } });
      }} /> : <View style={[ui.page, ui.content]}>
      <Text accessibilityLiveRegion="polite" style={ui.body}>{draft === null ? 'Product draft unavailable.' : 'Opening product draft…'}</Text>
      {draft === null ? <CameraActionButton label="Back to Pending sync" onPress={() => router.back()} /> : null}
    </View>}
  </>;
}
