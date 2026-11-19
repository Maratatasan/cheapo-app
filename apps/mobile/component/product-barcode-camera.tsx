import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { StyleSheet } from 'react-native';

import { canonicalProductBarcode } from '@/data/product-barcode';

export function ProductBarcodeCamera({ onRead, onError }: {
  onRead: (digits: string, canonical: string) => void;
  onError?: () => void;
}) {
  function onBarcodeScanned({ data }: BarcodeScanningResult) {
    if (typeof data !== 'string') return;
    const barcode = canonicalProductBarcode(data);
    if (barcode) onRead(data.trim(), barcode);
  }

  return <CameraView style={styles.preview} barcodeScannerSettings={{ barcodeTypes: ['ean8', 'ean13', 'upc_a'] }}
    onBarcodeScanned={onBarcodeScanned} onMountError={onError} />;
}

const styles = StyleSheet.create({ preview: { flex: 1, backgroundColor: '#000' } });
