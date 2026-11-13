import { useCallback, useRef, useState } from 'react';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Product } from '@cheapo/domain';
import { AddBarcodeProduct, type BarcodeProductDetails } from './add-barcode-product';
import { DisplayState } from './results/display-state';
import { ShopComparison, type ComparisonRow } from './results/shop-comparison';
import { CurrentShopPrice } from './results/current-shop-price';
import { CameraComponent } from './camera';
import { PhotoReview } from './photo-review';
import { ui } from './results/theme';
import { CameraActionButton, CameraPermissionActions } from './camera-actions';
import { loadSavedPriceRecords, saveManualPrice, type DraftShop, type ManualPriceRecord } from '@/data/local-photo';
import { addLocalProduct, findLocalProductByBarcode } from '@/data/local-products';
import { canonicalProductBarcode } from '@/data/product-barcode';
import { comparisonRowFromDraft } from '@/data/saved-comparison';
import { calculatePackUnitPrice, emptyReview, reviewComplete } from '@/data/photo-review';

type ScanResult =
  | { kind: 'loading' | 'error' }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'known'; product: Product; comparisons: ComparisonRow[]; reference?: ComparisonRow;
      currentPrice?: Pick<ComparisonRow, 'price' | 'currency'> & { capturedOn: string }; photo?: string };

type ScanEntry =
  | { kind: 'product'; id: string; barcode: string }
  | { kind: 'price'; record: ManualPriceRecord };

function packLabel(pack: Product['pack']) {
  return pack && (pack.label ?? `${pack.quantity} ${pack.unit}`);
}

async function loadComparison(product: Product, shopId: string): Promise<Extract<ScanResult, { kind: 'known' }>> {
  const drafts = await loadSavedPriceRecords();
  const rows = drafts.flatMap(draft => {
    const row = comparisonRowFromDraft(draft);
    return row ? [{ row, draft }] : [];
  });
  const linked = rows.find(({ draft }) => draft.productId === product.id);
  const current = rows.find(({ draft }) => draft.productId === product.id && draft.shop?.id === shopId);
  return { kind: 'known', product, comparisons: rows.map(({ row }) => row),
    reference: linked?.row, currentPrice: current?.row, photo: linked?.draft.selected?.uri };
}

export function BarcodeScan({ currentShop, onScanLabel }: { currentShop: DraftShop; onScanLabel: () => void }) {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [result, setResult] = useState<ScanResult>();
  const [entry, setEntry] = useState<ScanEntry>();
  const [capture, setCapture] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const active = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const selected = useRef<Product | undefined>(undefined);
  const pendingSave = useRef(false);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    active.current = controller;
    setFocused(true);
    if (selected.current) {
      loadComparison(selected.current, currentShop.id).then(next => {
        if (!controller.signal.aborted) setResult(next);
      }).catch(() => {
        if (!controller.signal.aborted) setResult({ kind: 'error' });
      });
    }
    return () => {
      controller.abort();
      active.current = null;
      setFocused(false);
      if (reading.current) {
        reading.current = false;
        setResult(current => current?.kind === 'loading' ? undefined : current);
      }
    };
  }, [currentShop.id]));

  async function onBarcodeScanned({ data }: BarcodeScanningResult) {
    const signal = active.current?.signal;
    const barcode = canonicalProductBarcode(data);
    if (!signal || reading.current || !barcode) return;
    reading.current = true;
    setResult({ kind: 'loading' });
    try {
      const product = await findLocalProductByBarcode(barcode);
      if (signal.aborted) return;
      if (!product) {
        setResult({ kind: 'unknown', barcode });
        return;
      }
      const comparison = await loadComparison(product, currentShop.id);
      if (signal.aborted) return;
      selected.current = product;
      setResult(comparison);
    } catch {
      if (!signal.aborted) setResult({ kind: 'error' });
    }
  }

  function scanAgain() {
    setEntry(undefined);
    setCapture(false);
    setSaveError(undefined);
    selected.current = undefined;
    reading.current = false;
    setResult(undefined);
  }

  async function saveProduct(details: BarcodeProductDetails) {
    const signal = active.current?.signal;
    if (entry?.kind !== 'product' || !signal || pendingSave.current) return;
    pendingSave.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      await addLocalProduct({ ...details, id: entry.id, barcode: entry.barcode });
      if (!signal.aborted) scanAgain();
    } catch (error) {
      if (!signal.aborted) setSaveError(error instanceof Error ? error.message : 'Could not save this product. Try again.');
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  }

  function startPrice(product: Product) {
    const pack = packLabel(product.pack);
    setEntry({ kind: 'price', record: {
      id: randomUUID(), capturedAt: new Date().toISOString(), productId: product.id, shop: currentShop,
      review: { ...emptyReview(currentShop.displayName), productName: product.name, productType: product.productType,
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
      await saveManualPrice({ ...record, capturedAt: new Date().toISOString() });
      if (!signal.aborted) scanAgain();
    } catch {
      if (!signal.aborted) setSaveError('Could not save this price. Your entries are still here. Try again.');
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  }

  if (entry?.kind === 'product') return <AddBarcodeProduct barcode={entry.barcode} busy={saving} error={saveError}
    onSave={saveProduct} onCancel={scanAgain} />;

  const priceRecord = entry?.kind === 'price' ? entry.record : undefined;
  if (priceRecord && capture) return (
    <CameraComponent currentShop={priceRecord.shop} linkedPrice={{ productId: priceRecord.productId,
      initialReview: priceRecord.review, onCancel: () => setCapture(false), onSaved: scanAgain }} />
  );
  if (priceRecord) return (
    <PhotoReview review={priceRecord.review} selectedShopName={priceRecord.shop.displayName} recordingPrice
      saved={false} busy={saving} onReviewChange={review => setEntry({ kind: 'price', record: { ...priceRecord, review } })}
      onSave={savePrice} onCancel={() => setEntry(undefined)} saveError={saveError}>
      <CameraActionButton label="Scan shelf label" disabled={saving} onPress={() => setCapture(true)} />
    </PhotoReview>
  );

  if (result) return (
    <View style={ui.page}>
      <ScrollView contentContainerStyle={ui.content}>
        {result.kind === 'known' ? (
          <>
            <CurrentShopPrice shop={currentShop.displayName} observation={result.currentPrice}
              onRecord={() => startPrice(result.product)} />
            <ShopComparison catalogProduct={result.product} comparisons={result.comparisons} reference={result.reference}
              product={{ name: result.product.name,
                pack: packLabel(result.product.pack),
                photo: result.photo ? { uri: result.photo } : undefined }}
              onEdit={id => router.push({ pathname: '/edit-price/[id]', params: { id } })} />
          </>
        ) : result.kind === 'loading' ? (
          <DisplayState kind="loading" title="Looking up barcode" description="Checking products saved on this phone." />
        ) : result.kind === 'unknown' ? (
          <DisplayState kind="empty" title="Product not found" description="This barcode is not in your saved products."
            actionLabel="Add product" onAction={() => setEntry({ kind: 'product', id: randomUUID(), barcode: result.barcode })} />
        ) : (
          <DisplayState kind="error" title="Couldn’t look up barcode" description="Try scanning again." />
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
      <CameraPermissionActions onGrant={requestPermission} disabled={!permission.canAskAgain}>
        <CameraActionButton label="Scan label" onPress={onScanLabel} />
      </CameraPermissionActions>
    </View>
  );
  return (
    <View style={styles.camera}>
      {focused ? <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['ean8', 'ean13', 'upc_a'] }}
        onBarcodeScanned={onBarcodeScanned} /> : <View style={styles.camera} />}
      <SafeAreaView edges={['bottom']} style={styles.actions}>
        <Text style={styles.guide}>Point the camera at the product barcode.</Text>
        <CameraActionButton label="Scan label" onPress={onScanLabel} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  camera: { flex: 1, backgroundColor: '#000' },
  permission: { flex: 1, justifyContent: 'center', backgroundColor: '#000', padding: 24 },
  actions: { padding: 16, gap: 8 },
  guide: { color: '#fff', textAlign: 'center' },
});
