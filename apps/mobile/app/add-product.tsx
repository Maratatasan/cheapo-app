import { shopDisplayName } from '@cheapo/domain/names';
import { randomUUID } from 'expo-crypto';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { AddProductPriceReview, type AddProductPriceReviewProps, type ProductPriceSubmission } from '@/component/add-product-price-review';
import { CameraActionButton } from '@/component/camera-actions';
import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { ShopChooser, ShopLoadFeedback } from '@/component/shop/shop-chooser';
import { ui } from '@/component/results/theme';
import { loadSharedBarcodePrices } from '@/data/barcode-shared-prices';
import { createOwnerShoppingReads } from '@/data/cheapo-shopping-read-device';
import type { LocalPhotoDraft } from '@/data/local-photo';
import type { CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';
import { useEnrolledCatalog } from '@/hooks/use-enrolled-catalog';
import { useSavedShops } from '@/hooks/use-saved-shops';
import { choosePhoto } from '@/lib/choose-photo';
import { photoShopCountry } from '@/lib/direct-auth/shop-country';
import { fieldCheapoApiOrigin } from '@/lib/cheapo-access/config';

export default function AddProductScreen() {
  const router = useRouter();
  const shopping = useCheapoShopping();
  if (Platform.OS === 'web' || (!shopping && !fieldCheapoApiOrigin())) return <Redirect href="/" />;
  return <>
    <Stack.Screen options={{ title: 'Add product' }} />
    {shopping ? <EnrolledAddProduct key={JSON.stringify(shopping.owner)} shopping={shopping} /> :
      <View style={[ui.page, ui.content]}>
        <Text style={ui.body}>Connect Cheapo to check the shared catalog and record a shop price.</Text>
        <CameraActionButton label="Cheapo access" onPress={() => router.push('/cheapo-access')} />
      </View>}
  </>;
}

function EnrolledAddProduct({ shopping }: { shopping: CheapoShoppingRuntime }) {
  const router = useRouter();
  const catalog = useEnrolledCatalog();
  const { shops, shopRepository, setShops, readError, retry } = useSavedShops();
  const [choosingShop, setChoosingShop] = useState(false);
  const [photo, setPhoto] = useState<LocalPhotoDraft>();
  const [ids] = useState(() => ({ sourceId: randomUUID(), productId: randomUUID(), catalogOperationId: randomUUID() }));
  const active = useRef(true);
  const picking = useRef(false);
  const when = useRef<string | undefined>(undefined);

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const shop = useMemo(() => {
    const selected = shops?.currentShop;
    const displayName = selected && shopDisplayName(selected);
    return selected && displayName ? { id: selected.id, displayName } : undefined;
  }, [shops?.currentShop]);

  const lookup = useMemo<AddProductPriceReviewProps['lookup']>(() => {
    const reads = createOwnerShoppingReads(shopping.owner);
    return {
      async findByBarcode(barcode, signal) {
        if (!catalog) throw Error('Catalog is unavailable.');
        return catalog.findByBarcode(barcode, signal);
      },
      async findCandidates(identity, signal) {
        const result = await reads.searchProductCandidates(identity, signal);
        if (result.status !== 'fresh') throw Error('Catalog is unavailable.');
        return result.value;
      },
    };
  }, [shopping, catalog]);

  const loadLatestPrice = useCallback<NonNullable<AddProductPriceReviewProps['loadLatestPrice']>>(async (product, shop, signal) => {
    const { currentPrice, history } = await loadSharedBarcodePrices(shopping, product, shop.id, signal);
    return currentPrice ?? (history.cached || history.unavailable || history.hasMore ? undefined : null);
  }, [shopping]);

  async function pickPhoto() {
    if (picking.current) return;
    picking.current = true;
    try {
      const asset = await choosePhoto();
      if (active.current && asset) setPhoto({ id: ids.sourceId, capturedAt: new Date().toISOString(), original: asset, selected: asset });
    } catch {
      if (active.current) Alert.alert('Photo unavailable', 'Keep entering details manually or choose another photo.');
    } finally { picking.current = false; }
  }

  async function submit(input: ProductPriceSubmission): Promise<'queued' | 'draft'> {
    const { choice, shop, review, photo, barcode } = input;
    const createdAt = when.current ??= new Date().toISOString();
    const base = { id: ids.sourceId, capturedAt: photo?.capturedAt ?? createdAt, shop, review,
      productId: choice?.kind === 'reuse' ? choice.product.id : ids.productId };
    const record = photo ? { ...photo, ...base } : base;
    await shopping.productPrices.stage({ record, catalogOperationId: ids.catalogOperationId, createdAt, barcode });
    if (!choice) return 'draft';
    try {
      await shopping.productPrices.confirm(ids.sourceId, choice.kind === 'reuse'
        ? { kind: 'reuse', productId: choice.product.id } : { kind: 'add' });
    } catch {
      // The reviewed draft was staged before any promotion. Pending sync can
      // recover it or resume the recorded choice if promotion was interrupted.
      return 'draft';
    }
    void shopping.retry().catch(() => {});
    return 'queued';
  }

  return <View style={ui.page}>
    <View style={choosingShop ? { display: 'none' } : ui.page}>
      <AddProductPriceReview shop={shop} shopCountry={photoShopCountry(shops?.currentShop?.address)} photo={photo} lookup={lookup} loadLatestPrice={loadLatestPrice}
        onChooseShop={() => setChoosingShop(true)} onPickPhoto={() => { void pickPhoto(); }} onCancel={() => router.back()}
        onCompare={candidate => {
          if (candidate.kind === 'catalog') router.push({ pathname: '/find-product', params: { productId: candidate.product.id } });
          else router.push({ pathname: '/compare/[id]', params: { id: candidate.observationId, source: 'shared' } });
        }} onSubmit={submit} />
    </View>
    {choosingShop ? shops ? <ShopChooser state={shops} actions={shopRepository}
      onSelected={state => { setShops(state); setChoosingShop(false); }} onCancel={() => setChoosingShop(false)} />
      : <View style={ui.page}>
        <ShopLoadFeedback error={readError} onRetry={retry} />
        <CameraActionButton label="Back to price review" onPress={() => setChoosingShop(false)} />
      </View> : null}
  </View>;
}
