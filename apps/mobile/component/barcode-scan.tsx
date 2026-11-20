import { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Product } from '@cheapo/domain';
import { AddBarcodeProduct, type BarcodeProductDetails } from './add-barcode-product';
import { BarcodeEditor, BarcodeResultActions } from './barcode-editor';
import { BarcodeLookupFeedback } from './barcode-lookup-feedback';
import type { ComparisonRow } from './results/shop-comparison';
import { BarcodePriceComparison } from './barcode-price-comparison';
import { CameraComponent } from './camera';
import { BarcodePriceSaveNotice } from '@/component/barcode-price-save-notice';
import { useCheapoShopping } from './cheapo-shopping-provider';
import { ProductBarcodeCamera } from './product-barcode-camera';
import { PhotoReview } from './photo-review';
import { ui } from './results/theme';
import { CameraActionButton, CameraPermissionActions } from './camera-actions';
import { loadSavedPriceRecords, saveManualPrice, type DraftShop, type ManualPriceRecord } from '@/data/local-photo';
import { loadSharedBarcodePhoto, loadSharedBarcodePrices, type BarcodeSharedPriceHistory } from '@/data/barcode-shared-prices';
import { cheapoShoppingReadCache } from '@/data/cheapo-shopping-read-cache';
import { comparisonPreferenceGroup } from '@/data/enrolled-comparison-preferences';
import { addLocalProduct, replaceLocalProductBarcode } from '@/data/local-products';
import { findCatalogProductByBarcode } from '@/data/exact-barcode';
import { canonicalProductBarcode } from '@/data/product-barcode';
import { comparisonRowFromDraft } from '@/data/saved-comparison';
import { calculatePackUnitPrice, emptyReview, reviewComplete, type ManualReview } from '@/data/photo-review';
import { useEnrolledCatalog } from '@/hooks/use-enrolled-catalog';
import { useComparisonPreference } from '@/hooks/use-comparison-preference';
import { usePriceSaveNotice } from '@/hooks/use-price-save-notice';
import { useProductPhotoSource } from '@/hooks/use-product-presentation-photo';
import { useProductPhotoUri } from '@/hooks/use-product-photo-uri';
import type { PhotoSavePending } from '@/data/price-records';
import type { CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';

type ScanResult =
  | { kind: 'loading' }
  | { kind: 'error'; detail?: string }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'known'; barcode: string; product: Product; comparisons: ComparisonRow[]; reference?: ComparisonRow;
      currentPrice?: Pick<ComparisonRow, 'price' | 'currency'> & { capturedOn: string }; photo?: string;
      history?: BarcodeSharedPriceHistory };

type ScanEntry =
  | { kind: 'product'; id: string; barcode: string }
  | { kind: 'price'; record: ManualPriceRecord; barcode?: string };

type BarcodeEdit = { current: string; target?: Product; proposed?: string; mode: 'choose' | 'scan' | 'manual'; error?: string };

function packLabel(pack: Product['pack']) {
  return pack && (pack.label ?? `${pack.quantity} ${pack.unit}`);
}

async function loadComparison(
  product: Product, shopId: string | undefined, barcode: string, signal: AbortSignal,
  shopping: CheapoShoppingRuntime | null, previous?: BarcodeSharedPriceHistory, localOnly = false,
): Promise<Extract<ScanResult, { kind: 'known' }>> {
  if (shopping) {
    return { kind: 'known', barcode, product,
      ...await loadSharedBarcodePrices(shopping, product, shopId, signal, previous?.pages, localOnly) };
  }
  const drafts = await loadSavedPriceRecords();
  const rows = drafts.flatMap(draft => {
    const row = comparisonRowFromDraft(draft);
    return row ? [{ row, draft }] : [];
  });
  const linked = rows.find(({ draft }) => draft.productId === product.id);
  const current = shopId ? rows.find(({ draft }) => draft.productId === product.id && draft.shop?.id === shopId) : undefined;
  return { kind: 'known', barcode, product, comparisons: rows.map(({ row }) => row),
    reference: linked?.row, currentPrice: current?.row, photo: linked?.draft.selected?.uri };
}

export function BarcodeScan({ currentShop, onScanLabel, initialBarcode }: {
  currentShop?: DraftShop; onScanLabel: () => void; initialBarcode?: string;
}) {
  const router = useRouter();
  const shopping = useCheapoShopping();
  const catalog = useEnrolledCatalog();
  const shopId = currentShop?.id;
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [result, setResult] = useState<ScanResult | undefined>(() => initialBarcode ? { kind: 'loading' } : undefined);
  const [entry, setEntry] = useState<ScanEntry>();
  const [barcodeEdit, setBarcodeEdit] = useState<BarcodeEdit>();
  const [capture, setCapture] = useState(false);
  const [productPhoto, setProductPhoto] = useState<{ shop: DraftShop; review: ManualReview }>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState<{ sourceId: string; pending: PhotoSavePending }>();
  const [paging, setPaging] = useState(false);
  const [sharedPhoto, setSharedPhoto] = useState<{ owner: CheapoShoppingRuntime; id: string; version: number; uri: string }>();
  const saveNotice = usePriceSaveNotice(shopping, saved?.sourceId, saved?.pending);
  const active = useRef<AbortController | null>(null);
  const reads = useRef<AbortController | null>(null);
  const readingPhoto = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const initialLookup = useRef(initialBarcode);
  const selected = useRef<{ product: Product; barcode: string } | undefined>(undefined);
  const pendingSave = useRef(false);
  const lookup = useCallback(async (barcode: string) => {
    const signal = reads.current?.signal;
    if (!signal || reading.current) return;
    reading.current = true;
    setSaved(undefined);
    setResult({ kind: 'loading' });
    try {
      const product = await findCatalogProductByBarcode(catalog, barcode, signal);
      if (signal.aborted) return;
      if (!product) {
        setResult({ kind: 'unknown', barcode });
        return;
      }
      const comparison = await loadComparison(product, shopId, barcode, signal, shopping);
      if (signal.aborted) return;
      selected.current = { product, barcode };
      setResult(comparison);
    } catch (error) {
      if (!signal.aborted) setResult({ kind: 'error', detail: catalog && error instanceof Error ? error.message : undefined });
    } finally {
      if (!signal.aborted && initialLookup.current === barcode) initialLookup.current = undefined;
    }
  }, [catalog, shopId, shopping]);
  const referencePhoto = result?.kind === 'known' && !entry && !barcodeEdit ? result.history?.referencePhoto : undefined;
  const selectedGroup = shopping && result?.kind === 'known' && !entry && !barcodeEdit
    ? comparisonPreferenceGroup(result.product.comparableGroupId, result.product.productType) : undefined;
  const preference = useComparisonPreference(shopping, selectedGroup);
  const productPhotos = useProductPhotoSource(shopping?.owner);
  const canonicalPhoto = useProductPhotoUri(productPhotos,
    result?.kind === 'known' && !entry && !barcodeEdit ? result.product.id : undefined, focused);
  const photoId = referencePhoto?.id;
  const photoVersion = referencePhoto?.version;
  useEffect(() => {
    if (!shopping || !focused || !photoId || photoVersion === undefined) return;
    const controller = new AbortController();
    readingPhoto.current = controller;
    void loadSharedBarcodePhoto(shopping, photoId, controller.signal).catch(() => undefined).then(uri => {
      if (!controller.signal.aborted) {
        setSharedPhoto(uri ? { owner: shopping, id: photoId, version: photoVersion, uri } : undefined);
      }
    });
    return () => { controller.abort(); readingPhoto.current = null; };
  }, [focused, photoId, photoVersion, shopping]);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    const read = new AbortController();
    active.current = controller;
    reads.current = read;
    setFocused(true);
    if (selected.current) {
      loadComparison(selected.current.product, shopId, selected.current.barcode, read.signal, shopping).then(next => {
        if (!read.signal.aborted) setResult(next);
      }).catch(() => {
        if (!read.signal.aborted) setResult({ kind: 'error' });
      });
    } else if (initialLookup.current) {
      void lookup(initialLookup.current);
    }
    return () => {
      controller.abort();
      reads.current?.abort();
      reads.current = null;
      active.current = null;
      setFocused(false);
      if (reading.current) {
        reading.current = false;
        setResult(current => current?.kind === 'loading' ? undefined : current);
      }
    };
  }, [lookup, shopping, shopId]));

  useEffect(() => {
    if (!shopping) return;
    return cheapoShoppingReadCache.subscribeClear(() => {
      const readWasActive = reads.current !== null;
      reads.current?.abort();
      reads.current = readWasActive ? new AbortController() : null;
      readingPhoto.current?.abort();
      setSharedPhoto(undefined);
      setPaging(false);
      reading.current = false;
      const selection = selected.current;
      if (!selection) {
        setResult(current => current?.kind === 'loading' ? undefined : current);
        return;
      }
      const signal = reads.current?.signal;
      setResult({ kind: 'known', ...selection, comparisons: [],
        history: { pages: [], hasMore: false, cached: false, unavailable: true, referencePhoto: undefined, lastSyncedAt: undefined } });
      if (!signal) return;
      void loadComparison(selection.product, shopId, selection.barcode, signal, shopping, undefined, true).then(next => {
        if (!signal.aborted && selected.current === selection) setResult(next);
      }).catch(() => {});
    });
  }, [shopping, shopId]);

  function onBarcodeScanned(barcode: string) {
    if (barcodeEdit?.mode === 'scan') {
      setBarcodeEdit(current => current?.mode === 'scan'
        ? { ...current, mode: 'choose', proposed: barcode, error: undefined } : current);
    } else void lookup(barcode);
  }

  async function confirmBarcode() {
    const signal = active.current?.signal;
    if (!barcodeEdit || !signal || pendingSave.current) return;
    const proposed = canonicalProductBarcode(barcodeEdit.proposed ?? '');
    if (!proposed) {
      setBarcodeEdit({ ...barcodeEdit, error: 'Enter a valid product barcode.' });
      return;
    }
    if (!barcodeEdit.target) {
      setBarcodeEdit(undefined);
      selected.current = undefined;
      reading.current = false;
      await lookup(proposed);
      return;
    }
    pendingSave.current = true;
    setSaving(true);
    setBarcodeEdit({ ...barcodeEdit, error: undefined });
    try {
      const product = catalog ? await catalog.replaceBarcode(barcodeEdit.target, proposed)
        : await replaceLocalProductBarcode(barcodeEdit.target.id, barcodeEdit.current, proposed);
      if (signal.aborted) return;
      selected.current = { product, barcode: proposed };
      setResult(current => current?.kind === 'known' ? { ...current, product, barcode: proposed } : current);
      setBarcodeEdit(undefined);
    } catch (error) {
      if (!signal.aborted) setBarcodeEdit({ ...barcodeEdit, error: error instanceof Error ? error.message : 'Could not save the barcode. Try again.' });
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  }

  function scanAgain() {
    setEntry(undefined);
    setCapture(false);
    setProductPhoto(undefined);
    setSharedPhoto(undefined);
    setSaveError(undefined);
    selected.current = undefined;
    reading.current = false;
    setResult(undefined);
  }

  function photoSaved(pending?: PhotoSavePending, sourceId?: string) {
    scanAgain();
    setSaved(pending && sourceId ? { pending, sourceId } : undefined);
  }

  async function loadMore() {
    const signal = reads.current?.signal;
    if (!signal || result?.kind !== 'known' || !result.history?.hasMore || paging) return;
    setPaging(true);
    try {
      const next = await loadComparison(result.product, shopId, result.barcode, signal, shopping, result.history);
      if (!signal.aborted) setResult(current => current === result ? next : current);
    } catch {
      if (!signal.aborted) setResult(current => current === result && result.history
        ? { ...result, history: { ...result.history, unavailable: true } } : current);
    } finally {
      setPaging(false);
    }
  }

  if (barcodeEdit && barcodeEdit.mode !== 'scan') return (
    <BarcodeEditor current={barcodeEdit.current} productName={barcodeEdit.target?.name} proposed={barcodeEdit.proposed}
      manual={barcodeEdit.mode === 'manual'} busy={saving} error={barcodeEdit.error}
      onScan={() => setBarcodeEdit({ ...barcodeEdit, mode: 'scan', error: undefined })}
      onManual={() => setBarcodeEdit({ ...barcodeEdit, mode: 'manual', error: undefined })}
      onChange={proposed => setBarcodeEdit({ ...barcodeEdit, proposed, error: undefined })}
      onSave={confirmBarcode} onCancel={() => setBarcodeEdit(undefined)} />
  );
  const returnFromScan = barcodeEdit?.mode === 'scan' ? () => setBarcodeEdit({ ...barcodeEdit, mode: 'choose' }) : undefined;

  async function saveProduct(details: BarcodeProductDetails) {
    const signal = active.current?.signal;
    if (entry?.kind !== 'product' || !signal || pendingSave.current) return;
    pendingSave.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      const product = { ...details, id: entry.id, barcode: entry.barcode };
      if (catalog) await catalog.save(product);
      else await addLocalProduct(product);
      if (!signal.aborted) scanAgain();
    } catch (error) {
      if (!signal.aborted) setSaveError(error instanceof Error ? error.message : 'Could not save this product. Try again.');
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  }

  function startPrice(product: Product, shop: DraftShop) {
    const pack = packLabel(product.pack);
    setEntry({ kind: 'price', barcode: product.barcode, record: {
      id: randomUUID(), capturedAt: new Date().toISOString(), productId: product.id, shop,
      review: { ...emptyReview(shop.displayName), productName: product.name, productType: product.productType,
        variety: product.variety, brand: product.brand, packSize: pack && calculatePackUnitPrice('1', pack) ? pack : undefined },
    } });
    setSaveError(undefined);
  }

  async function savePrice() {
    const signal = active.current?.signal;
    if (entry?.kind !== 'price' || !signal || pendingSave.current) return;
    const { record } = entry;
    if (!reviewComplete(record.review, record.shop.displayName)) return;
    pendingSave.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      if (shopping) {
        await shopping.assertOwner();
        await shopping.priceRecords.saveManual(record);
        await shopping.assertOwner();
        void shopping.retry().catch(() => { /* The saved price remains pending. */ });
      } else {
        await saveManualPrice({ ...record, capturedAt: new Date().toISOString() });
      }
      if (!signal.aborted) {
        scanAgain();
        setSaved(shopping ? { sourceId: record.id, pending: 'waiting' } : undefined);
      }
    } catch {
      if (!signal.aborted) setSaveError('Could not save this price. Your entries are still here. Try again.');
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  }

  if (entry?.kind === 'product') return (
    <View style={ui.page}>
      <View style={productPhoto ? styles.hidden : ui.page}>
        <AddBarcodeProduct barcode={entry.barcode} busy={saving} error={saveError} onSave={saveProduct} onCancel={scanAgain}
          onPhoto={currentShop ? details => setProductPhoto({
            shop: currentShop, review: { ...emptyReview(currentShop.displayName), ...details },
          }) : undefined} />
      </View>
      {productPhoto ? <CameraComponent currentShop={productPhoto.shop}
        onCompareBarcode={barcode => router.push({ pathname: '/find-product', params: { barcode } })} barcodeCapture={{ barcode: entry.barcode,
        initialReview: productPhoto.review, onCancel: () => setProductPhoto(undefined), onSaved: photoSaved }} /> : null}
    </View>
  );

  if (entry?.kind === 'price') {
    const { barcode, record } = entry;
    if (capture) return (
      <CameraComponent currentShop={record.shop} linkedPrice={{ productId: record.productId, barcode,
        initialReview: record.review, onCancel: () => setCapture(false), onSaved: photoSaved }} />
    );
    return (
      <PhotoReview review={record.review} selectedShopName={record.shop.displayName} recordingPrice savedBarcode={barcode}
        saved={false} busy={saving} onReviewChange={review => setEntry({ ...entry, record: { ...record, review } })}
        onSave={savePrice} onCancel={() => setEntry(undefined)} saveError={saveError}>
        <CameraActionButton label="Scan shelf label" disabled={saving} onPress={() => setCapture(true)} />
      </PhotoReview>
    );
  }

  if (result && !returnFromScan) return (
    <View style={ui.page}>
      <ScrollView contentContainerStyle={ui.content}>
        {result.kind === 'known' ? (
          <>
            <BarcodeResultActions barcode={result.barcode}
              onLookup={() => setBarcodeEdit({ current: result.barcode, mode: 'choose' })}
              onEdit={() => setBarcodeEdit({ current: result.barcode, target: result.product, mode: 'choose' })} />
            <BarcodePriceComparison currentShop={currentShop} currentPrice={result.currentPrice} history={result.history} paging={paging}
              onRecord={() => { if (currentShop) startPrice(result.product, currentShop); }} onMore={() => { void loadMore(); }}
              comparison={{ catalogProduct: result.product, comparisons: result.comparisons, reference: result.reference,
                preference,
                exactProductId: result.history && !result.product.productType ? result.product.id : undefined,
                product: { name: result.product.name, pack: packLabel(result.product.pack),
                  photo: canonicalPhoto ? { uri: canonicalPhoto }
                    : sharedPhoto && sharedPhoto.owner === shopping && sharedPhoto.id === photoId && sharedPhoto.version === photoVersion
                      ? { uri: sharedPhoto.uri } : result.photo ? { uri: result.photo } : undefined,
                  photoLabel: canonicalPhoto ? `Product photo for ${result.product.name}` : undefined },
                onEdit: id => {
                  const source = ['shared', 'queued', 'legacy'].find(kind => result.history && id.startsWith(`${kind}:`));
                  router.push({ pathname: '/edit-price/[id]', params: {
                    id: source ? id.slice(source.length + 1) : id,
                    ...(source === 'shared' ? { source } : {}),
                  } });
                } }} />
          </>
        ) : result.kind === 'loading' ? (
          <BarcodeLookupFeedback state="loading" enrolled={Boolean(catalog)} />
        ) : result.kind === 'unknown' ? (
          <>
            <BarcodeResultActions barcode={result.barcode} onLookup={() => setBarcodeEdit({ current: result.barcode, mode: 'choose' })} />
            <BarcodeLookupFeedback state="missing" enrolled={Boolean(catalog)}
              onAdd={() => setEntry({ kind: 'product', id: randomUUID(), barcode: result.barcode })} />
          </>
        ) : (
          <BarcodeLookupFeedback state="error" enrolled={Boolean(catalog)} detail={result.detail} />
        )}
      </ScrollView>
      {result.kind !== 'loading' ? <SafeAreaView edges={['bottom']} style={styles.actions}>
        <CameraActionButton primary label="Scan another barcode" onPress={scanAgain} />
        <CameraActionButton label="Scan label" onPress={onScanLabel} />
      </SafeAreaView> : null}
    </View>
  );

  if (!permission) return <View style={styles.camera} />;
  if (!permission.granted) return (
    <View style={styles.permission}>
      {returnFromScan && !permission.canAskAgain ? <Text style={styles.guide}>Camera permission is unavailable. Return to the editor to enter the barcode manually.</Text> : null}
      <CameraPermissionActions onGrant={requestPermission} disabled={!permission.canAskAgain}>
        <CameraActionButton label={returnFromScan ? 'Back to barcode editor' : 'Scan label'} onPress={returnFromScan ?? onScanLabel} />
      </CameraPermissionActions>
    </View>
  );
  return (
    <View style={styles.camera}>
      {focused ? <ProductBarcodeCamera onRead={(_, barcode) => onBarcodeScanned(barcode)} /> : <View style={styles.camera} />}
      <SafeAreaView edges={['bottom']} style={styles.actions}>
        {saveNotice ? <BarcodePriceSaveNotice text={saveNotice} /> : null}
        <Text style={styles.guide}>Point the camera at the product barcode.</Text>
        <CameraActionButton label={returnFromScan ? 'Back to barcode editor' : 'Scan label'} onPress={returnFromScan ?? onScanLabel} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { display: 'none' },
  camera: { flex: 1, backgroundColor: '#000' },
  permission: { flex: 1, justifyContent: 'center', backgroundColor: '#000', padding: 24 },
  actions: { padding: 16, gap: 8 },
  guide: { color: '#fff', textAlign: 'center' },
});
