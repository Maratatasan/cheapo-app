import { normalizeName, shopDisplayName } from '@cheapo/domain/names';
import { randomUUID } from 'expo-crypto';
import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { Zip, ZipPassThrough } from 'fflate/browser';

import { loadLocalPhotos, reviewComplete, savedPhotoDirectory, type LocalPhotoDraft, type PhotoAsset } from '@/data/local-photo';
import { reviewUnitPrice } from '@/data/photo-review';
import { loadSavedShops } from '@/data/local-shops';

const CHUNK_BYTES = 128 * 1024;
const ZIP32_LIMIT = 0xffffffff;
const ZIP32_MAX_ENTRIES = 65534;
const ZIP_TYPE = 'application/zip';

class ExportError extends Error {}

function ensureActive(signal: AbortSignal) {
  if (signal.aborted) throw new ExportError('Export cancelled.');
}

function isTestShop(name?: string | null) {
  return normalizeName(name)?.toLowerCase() === 'test shop';
}

function describePhoto(asset: PhotoAsset, path: string) {
  return { path, width: asset.width, height: asset.height, mimeType: asset.mimeType };
}

function describeRecord(draft: LocalPhotoDraft, index: number) {
  const { review, shop, cropBox, original, selected } = draft;
  const shopName = shop?.displayName ?? normalizeName(review?.shop) ?? null;
  const prefix = `photos/${index + 1}`;
  const originalPath = `${prefix}/original.jpg`;
  const cropPath = original.uri !== selected.uri ? `${prefix}/crop.jpg` : null;
  return {
    id: draft.id,
    capturedAt: draft.capturedAt,
    productName: normalizeName(review?.productName) ?? null,
    shop: shopName ? { id: shop?.id ?? null, displayName: shopName } : null,
    testShop: isTestShop(shopName),
    status: reviewComplete(review, shop?.displayName) ? 'complete' : 'draft',
    review: review ? {
      productName: review.productName, price: review.price, currency: review.currency,
      packSize: normalizeName(review.packSize), shop: review.shop, unitPrice: review.unitPrice, unit: review.unit,
      productType: normalizeName(review.productType), variety: normalizeName(review.variety), brand: normalizeName(review.brand),
    } : null,
    unitPrice: review ? reviewUnitPrice(review) : null,
    cropBox: cropBox ? { left: cropBox.left, top: cropBox.top, right: cropBox.right, bottom: cropBox.bottom } : null,
    photos: {
      original: describePhoto(original, originalPath),
      crop: cropPath ? describePhoto(selected, cropPath) : null,
      selectedPath: cropPath ?? originalPath,
    },
  };
}

async function writeArchive(
  output: FileHandle, manifest: Uint8Array, photos: { path: string; source: File }[], signal: AbortSignal,
) {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const zip = new Zip((error, bytes) => {
    if (error) throw error;
    chunks.push(bytes);
  });
  async function flush() {
    ensureActive(signal);
    for (const chunk of chunks) {
      totalBytes += chunk.byteLength;
      if (totalBytes >= ZIP32_LIMIT) throw new ExportError('The collection is too large for one ZIP.');
      await output.writeBytes(chunk);
    }
    chunks.length = 0;
  }

  try {
    const entry = new ZipPassThrough('manifest.json');
    zip.add(entry);
    entry.push(manifest, true);
    await flush();
    for (const { path, source } of photos) {
      ensureActive(signal);
      const input = source.open(FileMode.ReadOnly);
      try {
        const expectedSize = input.size;
        if (!expectedSize) throw new ExportError('A saved photo is missing or empty. The ZIP could not be prepared.');
        if (totalBytes + expectedSize >= ZIP32_LIMIT) throw new ExportError('The collection is too large for one ZIP.');
        const photo = new ZipPassThrough(path);
        zip.add(photo);
        let remaining = expectedSize;
        while (remaining > 0) {
          ensureActive(signal);
          const bytes = await input.readBytes(Math.min(remaining, CHUNK_BYTES));
          if (!bytes.length) throw new ExportError('A saved photo could not be read in full. The ZIP could not be prepared.');
          remaining -= bytes.byteLength;
          photo.push(bytes, remaining === 0);
          await flush();
        }
      } finally {
        input.close();
      }
    }
    zip.end();
    await flush();
  } catch (error) {
    zip.terminate();
    throw error;
  }
}

export async function exportShoppingData(signal: AbortSignal): Promise<void> {
  let archive: File | undefined;
  let created = false;
  try {
    ensureActive(signal);
    if (!await isAvailableAsync()) throw new ExportError('Android sharing is unavailable on this phone.');
    const drafts = await loadLocalPhotos({ requireAll: true }).catch(() => {
      throw new ExportError('A saved record or photo is unreadable. The full collection could not be exported.');
    });
    if (!drafts.length) throw new ExportError('There are no saved products or photos to export.');
    const { shops } = await loadSavedShops();
    ensureActive(signal);
    const exportedAt = new Date().toISOString();
    const records = drafts.map(describeRecord);
    const photoDirectory = savedPhotoDirectory();
    function savedPhoto(asset: PhotoAsset, path: string) {
      const source = new File(asset.uri);
      if (source.uri !== new File(photoDirectory, source.name).uri ||
          !source.name.endsWith('.jpg') || !source.exists) {
        throw new ExportError('A saved photo is missing or unreadable. The ZIP could not be prepared.');
      }
      return { path, source };
    }
    const photos = drafts.flatMap((draft, index) => {
      const { original, crop } = records[index].photos;
      const source = savedPhoto(draft.original, original.path);
      return crop ? [source, savedPhoto(draft.selected, crop.path)] : [source];
    });
    if (photos.length + 1 > ZIP32_MAX_ENTRIES) throw new ExportError('The collection has too many files for one ZIP.');
    const manifest = new TextEncoder().encode(JSON.stringify({
      version: 1,
      exportedAt,
      records,
      savedShops: shops.map((shop) => {
        const displayName = shopDisplayName(shop);
        return {
          id: shop.id, displayName, name: shop.name, nickname: shop.nickname,
          address: shop.address, location: shop.location && {
            latitude: shop.location.latitude, longitude: shop.location.longitude,
          }, testShop: isTestShop(displayName),
        };
      }),
    }, null, 2));

    const directory = new Directory(Paths.cache, 'cheapo-shopping-exports');
    directory.create({ idempotent: true, intermediates: true });
    archive = new File(directory, `cheapo-shopping-${exportedAt.slice(0, 10)}-${randomUUID()}.zip`);
    archive.create();
    created = true;
    const output = archive.open(FileMode.WriteOnly);
    try {
      await writeArchive(output, manifest, photos, signal);
    } finally {
      output.close();
    }
    ensureActive(signal);
    await shareAsync(archive.uri, { mimeType: ZIP_TYPE, dialogTitle: 'Export saved products and photos' });
    // Android recipients may still read the shared file after the chooser returns.
    // Keep completed exports in OS-managed cache, outside the saved records.
  } catch (error) {
    if (created && archive) {
      try { archive.delete(); } catch { /* Leave failed temporary files to the cache. */ }
    }
    if (error instanceof ExportError) throw error;
    throw new ExportError('Could not export saved products and photos. Try again.');
  }
}
