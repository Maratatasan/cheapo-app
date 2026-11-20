import { scanFromURLAsync, type BarcodeType } from 'expo-camera';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { canonicalProductBarcode } from './product-barcode';

export type PhotoBarcodeResult =
  | { status: 'found'; codes: readonly string[] }
  | { status: 'empty' | 'unavailable' | 'error' };

const retailFormats: BarcodeType[] = ['ean8', 'ean13', 'upc_a'];
type NativeRetailBarcode = { readRetailBarcodes?(uri: string): Promise<readonly string[]> };

export async function decodePhotoBarcodes(originalUri: string): Promise<PhotoBarcodeResult> {
  try {
    let decodedValues: readonly unknown[];
    if (Platform.OS === 'ios' && /^file:\/\/\/[^\s]/.test(originalUri)) {
      const vision = requireOptionalNativeModule<NativeRetailBarcode>('CheapoPhotoText');
      if (!vision?.readRetailBarcodes) return { status: 'unavailable' };
      decodedValues = await vision.readRetailBarcodes(originalUri);
    } else if (Platform.OS === 'android' && /^(file|content):\/\//.test(originalUri)) {
      const matches = await scanFromURLAsync(originalUri, retailFormats);
      decodedValues = matches.map(match => match.raw ?? match.data);
    } else return { status: 'unavailable' };

    const codes = new Map<string, string>();
    for (const decoded of decodedValues) {
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
