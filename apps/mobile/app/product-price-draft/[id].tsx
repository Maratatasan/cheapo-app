import { Redirect, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';

import { CameraActionButton } from '@/component/camera-actions';
import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { PendingProductPriceReview } from '@/component/pending-product-price-review';
import { PhotoReview } from '@/component/photo-review';
import { ui } from '@/component/results/theme';
import { checkProductIdentity, type AddProductLookup, type ProductIdentityCheck } from '@/data/add-product-lookup';
import type { ProductPriceChoice, ProductPriceDraft } from '@/data/price-append-queue';
import type { ManualReview } from '@/data/photo-review';
import { canonicalProductBarcode } from '@/data/product-barcode';
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
  const [edit, setEdit] = useState<{ review: ManualReview; barcode: string }>();
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
      await shopping.productPrices.confirm(id, choice, draft.revision);
      if (!signal.aborted) router.back();
      void shopping.retry().catch(() => {});
    } catch {
      if (!signal.aborted) setError('Could not finish saving. Your draft is on this phone. Check Pending sync to continue.');
    } finally {
      saving.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  const editedBarcode = edit?.barcode.trim();
  const canonicalBarcode = editedBarcode ? canonicalProductBarcode(editedBarcode) ?? null : null;
  const invalidBarcode = Boolean(editedBarcode && !canonicalBarcode);

  async function saveEdits() {
    const signal = active.current?.signal;
    if (!signal || !edit || !draft || invalidBarcode || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const revised = await shopping.productPrices.update(id, {
        review: edit.review, barcode: canonicalBarcode, expectedRevision: draft.revision,
      });
      if (!signal.aborted) {
        setDraft(revised);
        setEdit(undefined);
        setBusy(false);
        reload();
      }
    } catch {
      if (!signal.aborted) setError('Could not save the draft changes. The earlier review is still protected.');
    } finally {
      saving.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  const reviewed = draft?.record.review;
  return <>
    <Stack.Screen options={{ title: 'Review product and price draft' }} />
    {edit && draft?.record.shop ? <PhotoReview addingProduct updatingDraft photo={draft.record.selected} review={edit.review}
      selectedShopName={draft.record.shop.displayName} saved={false} busy={busy} saveError={error}
      saveBlocked={invalidBarcode ? 'Enter a valid barcode or leave it blank.' : undefined}
      onReviewChange={review => setEdit(current => current && { ...current, review })}
      onSave={() => { void saveEdits(); }} onCancel={() => { setEdit(undefined); reload(); }}
      barcodeReview={<View style={ui.card}>
        <Text style={ui.body}>Product barcode (optional)</Text>
        <TextInput accessibilityLabel="Product barcode (optional)" value={edit.barcode} keyboardType="number-pad" maxLength={14}
          editable={!busy} style={ui.body} onChangeText={barcode => setEdit(current => current && { ...current, barcode })} />
      </View>} /> : draft ? <PendingProductPriceReview draft={draft} check={check} busy={busy} error={error}
      onRetry={reload} onBack={() => router.back()} onConfirm={choice => { void confirm(choice); }}
      onEdit={reviewed ? () => {
        setError(undefined);
        setEdit({ review: reviewed, barcode: draft.barcode ?? '' });
      } : undefined}
      onCompare={candidate => {
        if (candidate.kind === 'catalog') router.push({ pathname: '/find-product', params: { productId: candidate.product.id } });
        else router.push({ pathname: '/compare/[id]', params: { id: candidate.observationId, source: 'shared' } });
      }} /> : <View style={[ui.page, ui.content]}>
      <Text accessibilityLiveRegion="polite" style={ui.body}>{draft === null ? 'Product draft unavailable.' : 'Opening product draft…'}</Text>
      {draft === null ? <CameraActionButton label="Back to Pending sync" onPress={() => router.back()} /> : null}
    </View>}
  </>;
}
