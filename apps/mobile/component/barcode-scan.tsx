import { useCallback, useRef, useState } from 'react';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Product } from '@cheapo/domain';
import { AddBarcodeProduct, type BarcodeProductDetails } from './add-barcode-product';
import { BarcodeEditor, BarcodeResultActions } from './barcode-editor';
import { DisplayState } from './results/display-state';
import { ShopComparison, type ComparisonRow } from './results/shop-comparison';
import { CurrentShopPrice } from './results/current-shop-price';
import { CameraComponent } from './camera';
import { PhotoReview } from './photo-review';
import { ui } from './results/theme';
import { CameraActionButton, CameraPermissionActions } from './camera-actions';
import { loadSavedPriceRecords, saveManualPrice, type DraftShop, type ManualPriceRecord } from '@/data/local-photo';
import { addLocalProduct, findLocalProductByBarcode, replaceLocalProductBarcode } from '@/data/local-products';
import { canonicalProductBarcode } from '@/data/product-barcode';
import { comparisonRowFromDraft } from '@/data/saved-comparison';
import { calculatePackUnitPrice, emptyReview, reviewComplete } from '@/data/photo-review';

type ScanResult =
  | { kind: 'loading' | 'error' }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'known'; barcode: string; product: Product; comparisons: ComparisonRow[]; reference?: ComparisonRow;
      currentPrice?: Pick<ComparisonRow, 'price' | 'currency'> & { capturedOn: string }; photo?: string };

type ScanEntry =
  | { kind: 'product'; id: string; barcode: string }
  | { kind: 'price'; record: ManualPriceRecord };

type BarcodeEdit = { current: string; target?: Product; proposed?: string; mode: 'choose' | 'scan' | 'manual'; error?: string };

function packLabel(pack: Product['pack']) {
  return pack && (pack.label ?? `${pack.quantity} ${pack.unit}`);
}

async function loadComparison(product: Product, shopId: string, barcode: string): Promise<Extract<ScanResult, { kind: 'known' }>> {
  const drafts = await loadSavedPriceRecords();
  const rows = drafts.flatMap(draft => {
    const row = comparisonRowFromDraft(draft);
    return row ? [{ row, draft }] : [];
  });
  const linked = rows.find(({ draft }) => draft.productId === product.id);
  const current = rows.find(({ draft }) => draft.productId === product.id && draft.shop?.id === shopId);
  return { kind: 'known', barcode, product, comparisons: rows.map(({ row }) => row),
    reference: linked?.row, currentPrice: current?.row, photo: linked?.draft.selected?.uri };
}

export function BarcodeScan({ currentShop, onScanLabel }: { currentShop: DraftShop; onScanLabel: () => void }) {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [result, setResult] = useState<ScanResult>();
  const [entry, setEntry] = useState<ScanEntry>();
  const [barcodeEdit, setBarcodeEdit] = useState<BarcodeEdit>();
  const [capture, setCapture] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const active = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const selected = useRef<{ product: Product; barcode: string } | undefined>(undefined);
  const pendingSave = useRef(false);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    active.current = controller;
    setFocused(true);
    if (selected.current) {
      loadComparison(selected.current.product, currentShop.id, selected.current.barcode).then(next => {
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

  async function lookup(barcode: string) {
    const signal = active.current?.signal;
    if (!signal || reading.current) return;
    reading.current = true;
    setResult({ kind: 'loading' });
    try {
      const product = await findLocalProductByBarcode(barcode);
      if (signal.aborted) return;
      if (!product) {
        setResult({ kind: 'unknown', barcode });
        return;
      }
      const comparison = await loadComparison(product, currentShop.id, barcode);
      if (signal.aborted) return;
      selected.current = { product, barcode };
      setResult(comparison);
    } catch {
      if (!signal.aborted) setResult({ kind: 'error' });
    }
  }

  function onBarcodeScanned({ data }: BarcodeScanningResult) {
    const barcode = canonicalProductBarcode(data);
    if (!barcode) return;
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
      const product = await replaceLocalProductBarcode(barcodeEdit.target.id, barcodeEdit.current, proposed);
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
    setSaveError(undefined);
    selected.current = undefined;
    reading.current = false;
    setResult(undefined);
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

  if (result && !returnFromScan) return (
    <View style={ui.page}>
      <ScrollView contentContainerStyle={ui.content}>
        {result.kind === 'known' ? (
          <>
            <BarcodeResultActions barcode={result.barcode}
              onLookup={() => setBarcodeEdit({ current: result.barcode, mode: 'choose' })}
              onEdit={() => setBarcodeEdit({ current: result.barcode, target: result.product, mode: 'choose' })} />
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
          <>
            <BarcodeResultActions barcode={result.barcode} onLookup={() => setBarcodeEdit({ current: result.barcode, mode: 'choose' })} />
            <DisplayState kind="empty" title="Product not found" description="This barcode is not in your saved products."
              actionLabel="Add product" onAction={() => setEntry({ kind: 'product', id: randomUUID(), barcode: result.barcode })} />
          </>
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
      {returnFromScan && !permission.canAskAgain ? <Text style={styles.guide}>Camera permission is unavailable. Return to the editor to enter the barcode manually.</Text> : null}
      <CameraPermissionActions onGrant={requestPermission} disabled={!permission.canAskAgain}>
        <CameraActionButton label={returnFromScan ? 'Back to barcode editor' : 'Scan label'} onPress={returnFromScan ?? onScanLabel} />
      </CameraPermissionActions>
    </View>
  );
  return (
    <View style={styles.camera}>
      {focused ? <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ['ean8', 'ean13', 'upc_a'] }}
        onBarcodeScanned={onBarcodeScanned} /> : <View style={styles.camera} />}
      <SafeAreaView edges={['bottom']} style={styles.actions}>
        <Text style={styles.guide}>Point the camera at the product barcode.</Text>
        <CameraActionButton label={returnFromScan ? 'Back to barcode editor' : 'Scan label'} onPress={returnFromScan ?? onScanLabel} />
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
