import type { Product } from '@cheapo/domain';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { canonicalProductBarcode } from './product-barcode';

async function readLegacyProducts(): Promise<Map<string, Product>> {
  const file = new File(Paths.document, 'saved-products.json');
  if (!file.exists) return new Map();
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
  return barcodes;
}

const productsDirectory = () => new Directory(Paths.document, 'products-by-barcode');
const correctionsDirectory = () => new Directory(Paths.document, 'product-barcode-corrections');
let pendingMutation: Promise<unknown> = Promise.resolve();

async function findOriginalProduct(key: string): Promise<Product | undefined> {
  const file = new File(productsDirectory(), `${key}.json`);
  if (!file.exists) return (await readLegacyProducts()).get(key);

  const { productSchema } = require('@cheapo/domain') as typeof import('@cheapo/domain');
  const product = productSchema.parse(JSON.parse(await file.text()));
  if (!product.barcode || canonicalProductBarcode(product.barcode) !== key) throw Error('Invalid saved barcode association.');
  return product;
}

type BarcodeChange = { previous?: string; product: Product & { barcode: string } };

async function readCorrections() {
  const directory = correctionsDirectory();
  if (!directory.exists) return [];
  const revisions = directory.list().filter((entry): entry is File => entry instanceof File && /^\d{12}\.json$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const { productSchema } = require('@cheapo/domain') as typeof import('@cheapo/domain');
  return Promise.all(revisions.map(async file => {
    const entry = JSON.parse(await file.text());
    const product = productSchema.parse(entry.product);
    if ((entry.previous !== undefined && (typeof entry.previous !== 'string' || canonicalProductBarcode(entry.previous) !== entry.previous)) ||
      !product.barcode || canonicalProductBarcode(product.barcode) !== product.barcode) throw Error('Invalid saved barcode correction.');
    return { previous: entry.previous, product: { ...product, barcode: product.barcode }, revision: Number(file.name.slice(0, 12)) };
  }));
}

export async function findLocalProductByBarcode(barcode: string): Promise<Product | undefined> {
  const key = canonicalProductBarcode(barcode);
  if (!key) return undefined;
  const corrections = await readCorrections();
  for (const correction of corrections.reverse()) {
    if (correction.product.barcode === key) return correction.product;
    if (correction.previous === key) break;
  }
  const original = await findOriginalProduct(key);
  return corrections.some(change => change.previous === key && change.product.id === original?.id) ? undefined : original;
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingMutation.then(operation);
  pendingMutation = result.catch(() => {});
  return result;
}

export function addLocalProduct(input: Product & { barcode: string }): Promise<Product> {
  return serialize(() => publishProduct(input));
}

export function replaceLocalProductBarcode(id: string, previous: string, proposed: string): Promise<Product> {
  return serialize(async () => {
    const oldKey = canonicalProductBarcode(previous);
    const newKey = canonicalProductBarcode(proposed);
    if (!oldKey || !newKey) throw Error('Enter a valid product barcode.');
    const product = await findLocalProductByBarcode(oldKey);
    if (product?.id !== id) throw Error('This product’s barcode changed. Scan it again before editing.');
    if (oldKey === newKey) return product;
    const existing = await findLocalProductByBarcode(newKey);
    if (existing) throw Error(`This barcode belongs to ${existing.name}.`);

    const updated = { ...product, barcode: newKey };
    await publishChange({ previous: oldKey, product: updated });
    return updated;
  });
}

async function publishProduct(input: Product & { barcode: string }): Promise<Product> {
  const key = canonicalProductBarcode(input.barcode);
  if (!key || !input.productType?.trim()) throw Error('Enter a product type and valid barcode.');
  const { productSchema } = require('@cheapo/domain') as typeof import('@cheapo/domain');
  const product = { ...productSchema.parse({ ...input, barcode: key }), barcode: key };
  const existing = await findLocalProductByBarcode(key);
  if (existing) {
    if (existing.id === product.id) return existing;
    throw Error('This barcode already has a saved product. Scan it again to open that product.');
  }

  const directory = productsDirectory();
  directory.create({ intermediates: true, idempotent: true });
  if (new File(directory, `${key}.json`).exists) await publishChange({ product });
  else await publishFile(directory, `${key}.json`, product);
  return product;
}

async function publishChange(change: BarcodeChange) {
  const revisions = await readCorrections();
  const next = (revisions.at(-1)?.revision ?? 0) + 1;
  if (next > 999_999_999_999) throw Error('Barcode correction limit reached.');
  const directory = correctionsDirectory();
  directory.create({ intermediates: true, idempotent: true });
  // A single published file changes both lookup keys together.
  await publishFile(directory, `${String(next).padStart(12, '0')}.json`, change);
}

async function publishFile(directory: Directory, name: string, value: Product | BarcodeChange) {
  const destination = new File(directory, name);
  const pending = new File(directory, `${name}-${randomUUID()}.pending`);
  try {
    await pending.write(JSON.stringify(value));
    await pending.move(destination, { overwrite: false });
  } finally {
    if (pending.uri !== destination.uri && pending.exists) {
      try { pending.delete(); } catch { /* An unpublished file is ignored by lookup. */ }
    }
  }
}
