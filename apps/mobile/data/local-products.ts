import type { Product } from '@cheapo/domain';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { canonicalProductBarcode } from './product-barcode';

async function findInCatalog(key: string): Promise<Product | undefined> {
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
  return barcodes.get(key);
}

const productsDirectory = () => new Directory(Paths.document, 'products-by-barcode');
let pendingAdd: Promise<unknown> = Promise.resolve();

export async function findLocalProductByBarcode(barcode: string): Promise<Product | undefined> {
  const key = canonicalProductBarcode(barcode);
  if (!key) return undefined;
  const file = new File(productsDirectory(), `${key}.json`);
  if (!file.exists) return findInCatalog(key);

  const { productSchema } = require('@cheapo/domain') as typeof import('@cheapo/domain');
  const product = productSchema.parse(JSON.parse(await file.text()));
  if (!product.barcode || canonicalProductBarcode(product.barcode) !== key) throw Error('Invalid saved barcode association.');
  return product;
}

export function addLocalProduct(input: Product & { barcode: string }): Promise<Product> {
  const result = pendingAdd.then(() => publishProduct(input));
  pendingAdd = result.catch(() => {});
  return result;
}

async function publishProduct(input: Product & { barcode: string }): Promise<Product> {
  const key = canonicalProductBarcode(input.barcode);
  if (!key || !input.productType?.trim()) throw Error('Enter a product type and valid barcode.');
  const { productSchema } = require('@cheapo/domain') as typeof import('@cheapo/domain');
  const product = productSchema.parse({ ...input, barcode: key });
  const existing = await findLocalProductByBarcode(key);
  if (existing) {
    if (existing.id === product.id) return existing;
    throw Error('This barcode already has a saved product. Scan it again to open that product.');
  }

  const directory = productsDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `${key}.json`);
  const pending = new File(directory, `${key}-${randomUUID()}.pending`);
  try {
    await pending.write(JSON.stringify(product));
    await pending.move(destination, { overwrite: false });
  } catch (error) {
    if (!destination.exists) throw error;
    const saved = await findLocalProductByBarcode(key);
    if (saved?.id === product.id) return saved;
    throw Error('This barcode already has a saved product. Scan it again to open that product.');
  } finally {
    if (pending.uri !== destination.uri && pending.exists) {
      try { pending.delete(); } catch { /* An unpublished file is ignored by lookup. */ }
    }
  }
  return product;
}
