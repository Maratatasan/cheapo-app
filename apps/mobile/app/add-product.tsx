import { shopDisplayName } from '@cheapo/domain/names';
import { useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { AddProductPriceReview, type AddProductPriceReviewProps, type ProductPriceSubmission } from '@/component/add-product-price-review';
import { CameraActionButton } from '@/component/camera-actions';
import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { PhotoBarcodeScan } from '@/component/photo-barcode-scan';
import { ShopChooser, ShopLoadFeedback } from '@/component/shop/shop-chooser';
import { ui } from '@/component/results/theme';
import { loadSharedBarcodePrices } from '@/data/barcode-shared-prices';
import type { LocalPhotoDraft } from '@/data/local-photo';
import { addProductPhotoSources, type AddProductPhotoSource } from '@/data/photo-price-source';
import type { CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';
import { useAddProductLookup } from '@/hooks/use-add-product-lookup';
import { useSavedShops } from '@/hooks/use-saved-shops';
import { choosePhoto, takePhoto } from '@/lib/choose-photo';
import { photoShopCountry } from '@/lib/direct-auth/shop-country';
import { fieldCheapoApiOrigin } from '@/lib/cheapo-access/config';

export default function AddProductScreen() {
  const router = useRouter();
  const shopping = useCheapoShopping();
  const { photoSource } = useLocalSearchParams<{ photoSource?: string }>();
  const draftSource = typeof photoSource === 'string' ? addProductPhotoSources.get(photoSource) : undefined;
  const source = draftSource?.owner === shopping ? draftSource : undefined;
  useEffect(() => {
    if (!source || typeof photoSource !== 'string') return;
    return () => { if (addProductPhotoSources.get(photoSource) === source) addProductPhotoSources.delete(photoSource); };
  }, [photoSource, source]);
  if (Platform.OS === 'web' || (!shopping && !fieldCheapoApiOrigin())) return <Redirect href="/" />;
  return <>
    <Stack.Screen options={{ title: 'Add product' }} />
    {shopping ? <EnrolledAddProduct key={JSON.stringify([shopping.owner, source?.draft.id])} shopping={shopping} source={source} /> :
      <View style={[ui.page, ui.content]}>
        <Text style={ui.body}>Connect Cheapo to check the shared catalog and record a shop price.</Text>
        <CameraActionButton label="Cheapo access" onPress={() => router.push('/cheapo-access')} />
      </View>}
  </>;
}

function EnrolledAddProduct({ shopping, source }: { shopping: CheapoShoppingRuntime; source?: AddProductPhotoSource }) {
  const router = useRouter();
  const lookup = useAddProductLookup();
  const { shops, shopRepository, setShops, readError, retry } = useSavedShops();
  const [choosingShop, setChoosingShop] = useState(false);
  const [photo, setPhoto] = useState<LocalPhotoDraft | undefined>(source?.draft);
  const [ids] = useState(() => ({ sourceId: source?.draft.id ?? randomUUID(), productId: randomUUID(), catalogOperationId: randomUUID() }));
  const [permission, requestPermission] = useCameraPermissions();
  const [scan, setScan] = useState<{ read: (barcode: string) => void }>();
  const active = useRef(true);
  const picking = useRef(false);
  const when = useRef<string | undefined>(undefined);

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const shop = useMemo(() => {
    const selected = shops?.currentShop;
    const displayName = selected && shopDisplayName(selected);
    return selected && displayName ? { id: selected.id, displayName } : undefined;
  }, [shops?.currentShop]);

  const loadLatestPrice = useCallback<NonNullable<AddProductPriceReviewProps['loadLatestPrice']>>(async (product, shop, signal) => {
    const { currentPrice, history } = await loadSharedBarcodePrices(shopping, product, shop.id, signal);
    return currentPrice ?? (history.cached || history.unavailable || history.hasMore ? undefined : null);
  }, [shopping]);

  async function pickPhoto(source: 'camera' | 'library') {
    if (picking.current) return;
    picking.current = true;
    try {
      const asset = await (source === 'camera' ? takePhoto() : choosePhoto());
      if (!active.current || !asset) return;
      if (asset === 'camera-denied') {
        Alert.alert('Camera access is off', 'You can choose an existing photo or enter details manually.');
        return;
      }
      setPhoto({ id: ids.sourceId, capturedAt: new Date().toISOString(), original: asset, selected: asset });
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

  if (!lookup) return <ShopLoadFeedback error="Could not open your catalog. Reopen Add product to try again." onRetry={() => router.back()} />;
  return <View style={ui.page}>
    <View style={choosingShop ? { display: 'none' } : ui.page}>
      <AddProductPriceReview shop={shop} shopCountry={photoShopCountry(shops?.currentShop?.address)} photo={photo} lookup={lookup} loadLatestPrice={loadLatestPrice}
        initialReview={source?.details.review} initialBarcode={source?.details.barcode}
        onScanBarcode={permission ? read => setScan({ read }) : undefined}
        onChooseShop={() => setChoosingShop(true)} onPickPhoto={() => { void pickPhoto('library'); }}
        onTakePhoto={() => { void pickPhoto('camera'); }} onCancel={() => router.back()}
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
    {scan && permission ? <PhotoBarcodeScan permission={permission} requestPermission={requestPermission}
      onRead={barcode => { setScan(undefined); scan.read(barcode); }}
      onCancel={() => setScan(undefined)} onError={message => { setScan(undefined); Alert.alert('Camera unavailable', message); }} /> : null}
  </View>;
}
