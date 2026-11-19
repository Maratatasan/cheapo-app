import { scanFromURLAsync, type BarcodeType } from 'expo-camera';
import { Platform } from 'react-native';

import { canonicalProductBarcode } from './product-barcode';

export type PhotoBarcodeResult =
  | { status: 'found'; codes: readonly string[] }
  | { status: 'empty' | 'unavailable' | 'error' };

const retailFormats: BarcodeType[] = ['ean8', 'ean13', 'upc_a'];

export async function decodePhotoBarcodes(originalUri: string): Promise<PhotoBarcodeResult> {
  // Expo's iOS and web still-image scanners only support QR codes.
  if (Platform.OS !== 'android' || !/^(file|content):\/\//.test(originalUri)) {
    return { status: 'unavailable' };
  }

  try {
    const matches = await scanFromURLAsync(originalUri, retailFormats);
    const codes = new Map<string, string>();
    for (const match of matches) {
      const decoded = match.raw ?? match.data;
      if (typeof decoded !== 'string') continue;

      const digits = decoded.trim();
      const key = canonicalProductBarcode(digits);
      if (key && !codes.has(key)) codes.set(key, digits);
    }
    return codes.size ? { status: 'found', codes: [...codes.values()] } : { status: 'empty' };
  } catch {
    return { status: 'error' };
  }
}
