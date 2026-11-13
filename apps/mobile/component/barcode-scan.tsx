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
import { ui } from './results/theme';
import { CameraActionButton, CameraPermissionActions } from './camera-actions';
import { loadLocalPhotos } from '@/data/local-photo';
import { addLocalProduct, findLocalProductByBarcode } from '@/data/local-products';
import { canonicalProductBarcode } from '@/data/product-barcode';
import { comparisonRowFromDraft } from '@/data/saved-comparison';

type ScanResult =
  | { kind: 'loading' | 'error' }
  | { kind: 'unknown'; barcode: string }
  | { kind: 'known'; product: Product; comparisons: ComparisonRow[]; reference?: ComparisonRow; photo?: string };

async function loadComparison(product: Product): Promise<Extract<ScanResult, { kind: 'known' }>> {
  const drafts = await loadLocalPhotos();
  const rows = drafts.flatMap(draft => {
    const row = comparisonRowFromDraft(draft);
    return row ? [{ row, draft }] : [];
  });
  const linked = rows.find(({ draft }) => draft.productId === product.id);
  return { kind: 'known', product, comparisons: rows.map(({ row }) => row),
    reference: linked?.row, photo: linked?.draft.selected.uri };
}

export function BarcodeScan({ onScanLabel }: { onScanLabel: () => void }) {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [result, setResult] = useState<ScanResult>();
  const [entry, setEntry] = useState<{ id: string; barcode: string }>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const active = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const selected = useRef<Product | undefined>(undefined);
  const savePending = useRef(false);
  useFocusEffect(useCallback(() => {
    const controller = new AbortController();
    active.current = controller;
    setFocused(true);
    if (selected.current) {
      loadComparison(selected.current).then(next => {
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
  }, []));

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
      const comparison = await loadComparison(product);
      if (signal.aborted) return;
      selected.current = product;
      setResult(comparison);
    } catch {
      if (!signal.aborted) setResult({ kind: 'error' });
    }
  }

  function scanAgain() {
    setEntry(undefined);
    setSaveError(undefined);
    selected.current = undefined;
    reading.current = false;
    setResult(undefined);
  }

  async function saveProduct(details: BarcodeProductDetails) {
    const signal = active.current?.signal;
    if (!entry || !signal || savePending.current) return;
    savePending.current = true;
    setSaving(true);
    setSaveError(undefined);
    try {
      await addLocalProduct({ ...details, ...entry });
      scanAgain();
    } catch (error) {
      if (!signal.aborted) setSaveError(error instanceof Error ? error.message : 'Could not save this product. Try again.');
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }

  if (entry) return <AddBarcodeProduct barcode={entry.barcode} busy={saving} error={saveError}
    onSave={saveProduct} onCancel={scanAgain} />;

  if (result) return (
    <View style={ui.page}>
      <ScrollView contentContainerStyle={ui.content}>
        {result.kind === 'known' ? (
          <ShopComparison catalogProduct={result.product} comparisons={result.comparisons} reference={result.reference}
            product={{ name: result.product.name,
              pack: result.product.pack && (result.product.pack.label ?? `${result.product.pack.quantity} ${result.product.pack.unit}`),
              photo: result.photo ? { uri: result.photo } : undefined }}
            onEdit={id => router.push({ pathname: '/edit-price/[id]', params: { id } })} />
        ) : result.kind === 'loading' ? (
          <DisplayState kind="loading" title="Looking up barcode" description="Checking products saved on this phone." />
        ) : result.kind === 'unknown' ? (
          <DisplayState kind="empty" title="Product not found" description="This barcode is not in your saved products."
            actionLabel="Add product" onAction={() => setEntry({ id: randomUUID(), barcode: result.barcode })} />
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
