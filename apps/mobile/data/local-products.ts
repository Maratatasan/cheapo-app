import type { Product } from '@cheapo/domain';
import { File, Paths } from 'expo-file-system';
import { canonicalProductBarcode } from './product-barcode';

export async function findLocalProductByBarcode(barcode: string): Promise<Product | undefined> {
  const file = new File(Paths.document, 'saved-products.json');
  if (!file.exists) return undefined;
  const snapshot: unknown = JSON.parse(await file.text());
  if (!Array.isArray(snapshot)) throw Error('Invalid saved product catalog.');

  const { productSchema } = require('@cheapo/domain') as typeof import('@cheapo/domain');
  const ids = new Set<string>();
  const barcodes = new Map<string, Product>();
  for (const entry of snapshot) {
    const product = productSchema.parse(entry);
    if (ids.has(product.id)) throw Error('Duplicate saved product ID.');
    ids.add(product.id);
    if (!product.barcode) continue;
    const key = canonicalProductBarcode(product.barcode);
    if (!key || barcodes.has(key)) throw Error('Invalid or duplicate saved barcode.');
    barcodes.set(key, product);
  }
  const key = canonicalProductBarcode(barcode);
  return key ? barcodes.get(key) : undefined;
}
