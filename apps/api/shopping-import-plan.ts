import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { productSchema, shopSchema, type Product } from '@cheapo/domain';
import { canonicalProductBarcode } from '@cheapo/domain/product-barcode';
import { z } from 'zod';

const stableId = z.string().regex(/^\S+$/u);
const positiveInteger = z.int().positive();
const rawReview = z.strictObject({
  productName: z.string().optional(),
  price: z.string().optional(),
  currency: z.string().optional(),
  packSize: z.string().nullable().optional(),
  shop: z.string().optional(),
  unitPrice: z.string().optional(),
  unit: z.string().optional(),
  productType: z.string().nullable().optional(),
  variety: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
});
const photoDescription = z.object({
  path: z.string().regex(/^photos\/[1-9]\d*\/(original|crop)\.jpg$/u),
  width: positiveInteger,
  height: positiveInteger,
  mimeType: z.literal('image/jpeg'),
});
const recordSchema = z.object({
  id: stableId,
  productId: stableId.nullish(),
  capturedAt: z.iso.datetime({ offset: true }),
  productName: z.string().nullable(),
  shop: z.object({ id: stableId.nullish(), displayName: z.string().min(1) }).nullable(),
  testShop: z.boolean(),
  status: z.enum(['draft', 'complete']),
  review: rawReview.nullable(),
  unitPrice: z.object({ amount: z.number().positive(), unit: z.string().min(1) }).nullable(),
  cropBox: z.object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() }).nullable(),
  photos: z.object({ original: photoDescription, crop: photoDescription.nullable(), selectedPath: z.string() }).nullable(),
});
// Keep the exported fields as written and check the domain's validity separately.
const sourceProduct = z.object({
  id: stableId,
  name: z.string(),
  productType: z.string().optional(),
  brand: z.string().optional(),
  variety: z.string().optional(),
  barcode: z.string().optional(),
  pack: z.object({ quantity: z.number(), unit: z.string(), label: z.string().optional() }).optional(),
  photoIds: z.array(stableId).optional(),
  comparableGroupId: stableId.optional(),
}).refine(product => productSchema.safeParse(product).success, 'Invalid product details');
const sourceShop = z.object({
  id: stableId,
  displayName: z.string().min(1),
  name: z.string().optional(),
  nickname: z.string().optional(),
  address: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  testShop: z.boolean(),
}).refine(shop => shopSchema.safeParse(shop).success, 'Invalid shop details');
const manifestFields = {
  exportedAt: z.iso.datetime({ offset: true }),
  records: z.array(recordSchema),
  savedShops: z.array(sourceShop),
};
const manifestSchema = z.discriminatedUnion('version', [
  z.object({ version: z.literal([1, 2]), ...manifestFields }),
  z.object({
    version: z.literal(3),
    ...manifestFields,
    source: z.object({
      appName: z.string().nullable(), appVersion: z.string().nullable(),
      androidVersionCode: positiveInteger.nullable(), platform: z.string().min(1),
    }),
    currentShopId: stableId.nullable(),
    catalog: z.object({
      legacyProducts: z.array(sourceProduct),
      originalProducts: z.array(sourceProduct),
      corrections: z.array(z.object({
        revision: positiveInteger.max(999_999_999_999),
        previous: z.string().optional(),
        product: sourceProduct,
      })),
    }),
  }),
]);

type Manifest = z.infer<typeof manifestSchema>;
type FullManifest = Extract<Manifest, { version: 3 }>;

function uniqueById<T extends { id: string }>(items: T[], collection: string): Map<string, T> {
  const entries = new Map(items.map(item => [item.id, item]));
  if (entries.size !== items.length) throw new Error(`Duplicate IDs in ${collection}.`);
  return entries;
}

function productGtin(product: Product): string | undefined {
  if (product.barcode === undefined) return undefined;
  const gtin = canonicalProductBarcode(product.barcode);
  if (!gtin) throw new Error('Catalog contains an invalid GTIN.');
  return gtin;
}

function catalogProducts(catalog: FullManifest['catalog'] | undefined) {
  const products = uniqueById(catalog?.legacyProducts ?? [], 'legacy products');
  const originals = uniqueById(catalog?.originalProducts ?? [], 'original products');
  for (const [id, original] of originals) {
    const legacy = products.get(id);
    if (legacy && !isDeepStrictEqual(legacy, original)) throw new Error('A product ID has conflicting original snapshots.');
    products.set(id, original);
  }
  const gtins = new Map([...products].map(([id, product]) => [id, productGtin(product)]));
  const revisions = [...catalog?.corrections ?? []].sort((a, b) => a.revision - b.revision);
  let latest = 0;
  for (const { revision, previous, product } of revisions) {
    const gtin = productGtin(product);
    if (revision === latest || !gtin || product.barcode !== gtin ||
      (previous === undefined && products.has(product.id)) ||
      (previous !== undefined && (!products.has(product.id) || gtins.get(product.id) !== previous))) {
      throw new Error(`Product correction ${revision} conflicts with the source catalog.`);
    }
    latest = revision;
    gtins.set(product.id, gtin);
    products.set(product.id, product);
  }
  const active = [...gtins.values()].filter(gtin => gtin !== undefined);
  if (new Set(active).size !== active.length) throw new Error('A GTIN is assigned to multiple active products.');
  return { products: [...products.values()].map(product => ({ ...product, gtin: gtins.get(product.id) ?? null })), revisions };
}

async function plainFile(root: string, relativePath: string): Promise<string> {
  const path = join(root, relativePath);
  try {
    if (await realpath(path) === path && (await lstat(path)).isFile()) return path;
  } catch {
    // Keep the user's local paths out of reports.
  }
  throw new Error(`Missing or unsafe backup file ${relativePath}.`);
}

async function hashPhoto(root: string, photo: z.infer<typeof photoDescription>) {
  const sha256 = createHash('sha256');
  const path = await plainFile(root, photo.path);
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      if (bytes === 0 && (chunk[0] !== 0xff || chunk[1] !== 0xd8 || chunk[2] !== 0xff)) {
        throw new Error('Invalid JPEG header');
      }
      bytes += chunk.length;
      sha256.update(chunk);
    }
  } catch {
    throw new Error(`Unreadable JPEG ${photo.path}.`);
  }
  if (bytes === 0) throw new Error(`Empty JPEG ${photo.path}.`);
  return { ...photo, bytes, sha256: sha256.digest('hex') };
}

async function photoReferences(root: string, records: Manifest['records']) {
  const seen = new Set<string>();
  const result = [];
  for (const { id, photos } of records) {
    if (!photos) continue;
    if (photos.selectedPath !== (photos.crop ?? photos.original).path) {
      throw new Error('A selected photo does not match its original or crop.');
    }
    for (const [role, photo] of [['original', photos.original], ['crop', photos.crop]] as const) {
      if (!photo) continue;
      if (!photo.path.endsWith(`/${role}.jpg`) || seen.has(photo.path) ||
          photo.path.split('/')[1] !== photos.original.path.split('/')[1]) {
        throw new Error(`Conflicting photo reference ${photo.path}.`);
      }
      seen.add(photo.path);
      result.push({ observationId: id, role, ...await hashPhoto(root, photo) });
    }
  }
  return result;
}

/** Read a privately extracted backup. Building the plan never starts a database or writes files. */
export async function planShoppingImport(directory: string) {
  const root = await realpath(directory).catch(() => { throw new Error('Backup directory is unavailable.'); });
  const manifestPath = await plainFile(root, 'manifest.json');
  let value: unknown;
  try {
    value = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error('Cannot read manifest.json as JSON.');
  }
  const input = manifestSchema.safeParse(value);
  if (!input.success) {
    const field = input.error.issues[0]?.path.join('.') || 'manifest';
    throw new Error(`Invalid backup field: ${field}.`);
  }
  const manifest = input.data;
  const sourceCatalog = manifest.version === 3 ? manifest.catalog : undefined;
  const { products, revisions } = catalogProducts(sourceCatalog);
  const productIds = new Set(products.map(({ id }) => id));
  const savedShops = uniqueById(manifest.savedShops, 'saved shops');
  const records = [...uniqueById(manifest.records, 'price observations').values()];
  const currentShopId = manifest.version === 3 ? manifest.currentShopId : null;
  if (currentShopId && !savedShops.has(currentShopId)) throw new Error('Current shop is missing from saved shops.');
  const observations = records.map(record => ({
    ...record,
    linkedProductId: record.productId && productIds.has(record.productId) ? record.productId : null,
    linkedShopId: record.shop?.id && savedShops.has(record.shop.id) ? record.shop.id : null,
  }));
  if (manifest.version === 3 && observations.some(record => record.productId && !record.linkedProductId)) {
    throw new Error('A price refers to a missing product in the complete backup.');
  }
  const photos = await photoReferences(root, records);
  const summary = {
    version: manifest.version,
    hasCatalog: manifest.version === 3,
    hasCurrentShopSelection: manifest.version === 3,
    products: products.length,
    catalogRevisions: revisions.length,
    savedShops: savedShops.size,
    observations: observations.length,
    drafts: observations.filter(({ status }) => status === 'draft').length,
    flaggedTestObservations: observations.filter(({ testShop }) => testShop).length,
    unresolvedProductIds: observations.filter(({ productId, linkedProductId }) => productId && !linkedProductId).length,
    unresolvedShopIds: observations.filter(({ shop, linkedShopId }) => shop?.id && !linkedShopId).length,
    originals: photos.filter(({ role }) => role === 'original').length,
    crops: photos.filter(({ role }) => role === 'crop').length,
  };
  return {
    summary, exportedAt: manifest.exportedAt,
    source: manifest.version === 3 ? manifest.source : undefined,
    sourceCatalog, products, revisions, shops: [...savedShops.values()], observations, currentShopId, photos,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  if (!directory || process.argv.length !== 3) {
    console.error('Pass one privately extracted backup directory to import:plan.');
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify((await planShoppingImport(directory)).summary, null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Could not validate the backup.');
      process.exitCode = 1;
    }
  }
}
