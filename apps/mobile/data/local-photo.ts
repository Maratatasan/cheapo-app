import { normalizeName } from '@cheapo/domain/names';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import type { CropBox } from './crop-geometry';
import { emptyReview, reviewComplete, type ManualReview } from './photo-review';

export { emptyReview, reviewComplete, type ManualReview } from './photo-review';

export type PhotoAsset = { uri: string; width: number; height: number; mimeType: 'image/jpeg'; size?: number };
export type DraftShop = { id: string; displayName: string };
type PriceRecord = { id: string; capturedAt: string; review?: ManualReview; shop?: DraftShop; productId?: string };
export type LocalPhotoDraft = PriceRecord & { original: PhotoAsset; selected: PhotoAsset; cropBox?: CropBox };
export type ManualPriceRecord = PriceRecord & {
  review: ManualReview; shop: DraftShop; productId: string; original?: never; selected?: never; cropBox?: never;
};
export type SavedPriceRecord = LocalPhotoDraft | ManualPriceRecord;
export async function localPhotoSource(asset: PhotoAsset): Promise<PhotoAsset> {
  if (!/^https?:/.test(asset.uri)) return asset;
  // Explicit development fixture selection may start as a remote JPEG.
  const file = await File.downloadFileAsync(asset.uri, new File(Paths.cache, `fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`));
  return { ...asset, uri: file.uri, size: file.size };
}
export const savedPhotoDirectory = () => new Directory(Paths.document, 'price-photos');

// A manifest is published only after both image files have been copied and checked.
export async function saveLocalPhoto(draft: LocalPhotoDraft): Promise<LocalPhotoDraft> {
  const directory = savedPhotoDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const copy = async (asset: PhotoAsset, name: string): Promise<PhotoAsset> => {
    const source = new File(asset.uri);
    const target = new File(directory, `${draft.id}-${name}.jpg`);
    if (source.uri !== target.uri && !target.exists) await source.copy(target);
    if (!target.exists || target.size <= 0) throw Error('Photo could not be saved.');
    return { ...asset, uri: target.uri, size: target.size };
  };
  const original = await localPhotoSource(draft.original);
  const selected = draft.original.uri === draft.selected.uri ? original : await localPhotoSource(draft.selected);
  const savedOriginal = await copy(original, 'original');
  const saved = { ...draft, original: savedOriginal, selected: draft.original.uri === draft.selected.uri ? savedOriginal : await copy(selected, `selected-${Date.now()}`) };
  await writeSavedDraft(directory, saved);
  return saved;
}

async function writeSavedDraft(directory: Directory, draft: SavedPriceRecord) {
  const manifest = new File(directory, `${draft.id}.json`);
  const previous = await readSavedDraft(manifest);
  // Never overwrite the last good fallback with an interrupted/invalid primary.
  // If making the safety copy fails, the primary has not been touched.
  if (previous?.id === draft.id) await new File(directory, `${draft.id}.json.bak`).write(JSON.stringify(previous));
  await manifest.write(JSON.stringify(draft));
}

function validSavedDraft(value: unknown): value is SavedPriceRecord {
  if (!value || typeof value !== 'object') return false;
  const draft = value as SavedPriceRecord;
  const asset = (photo?: PhotoAsset) => photo && typeof photo.uri === 'string' && photo.uri.startsWith('file:') && photo.mimeType === 'image/jpeg' && Number.isFinite(photo.width) && photo.width > 0 && Number.isFinite(photo.height) && photo.height > 0;
  if (typeof draft.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(draft.id) || typeof draft.capturedAt !== 'string' || !Number.isFinite(Date.parse(draft.capturedAt))) return false;
  if (draft.review !== undefined) {
    const review = draft.review;
    if (!review || !Object.keys(emptyReview()).every(key => typeof review[key as keyof ManualReview] === 'string')) return false;
    if ([review.productType, review.variety, review.brand, review.packSize].some(value => value !== undefined && typeof value !== 'string')) return false;
  }
  if (draft.shop !== undefined && (!draft.shop || typeof draft.shop.id !== 'string' || !/^\S+$/u.test(draft.shop.id) || !normalizeName(draft.shop.displayName))) return false;
  if (draft.productId !== undefined && (typeof draft.productId !== 'string' || !/^\S+$/u.test(draft.productId))) return false;
  if (draft.original === undefined && draft.selected === undefined) {
    return !!draft.productId && !!draft.shop && draft.cropBox === undefined && reviewComplete(draft.review, draft.shop.displayName);
  }
  if (!asset(draft.original) || !asset(draft.selected)) return false;
  const box = draft.cropBox;
  if (box !== undefined && (!box || ![box.left, box.top, box.right, box.bottom].every(value => Number.isFinite(value) && value >= 0 && value <= 1) || box.left >= box.right || box.top >= box.bottom)) return false;
  return true;
}

async function readSavedDraft(file: File): Promise<SavedPriceRecord | null> {
  try {
    if (!file.exists) return null;
    const value: unknown = JSON.parse(await file.text());
    if (!validSavedDraft(value)) return null;
    return !value.original || (new File(value.original.uri).exists && new File(value.selected.uri).exists) ? value : null;
  } catch { return null; }
}

export async function loadSavedPriceRecord(id: string): Promise<SavedPriceRecord | null> {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const directory = savedPhotoDirectory();
  const primary = await readSavedDraft(new File(directory, `${id}.json`));
  if (primary?.id === id) return primary;
  const backup = await readSavedDraft(new File(directory, `${id}.json.bak`));
  return backup?.id === id ? backup : null;
}

export async function saveManualPrice(record: ManualPriceRecord): Promise<ManualPriceRecord> {
  if (!validSavedDraft(record)) throw Error('Enter valid product and price details.');
  const directory = savedPhotoDirectory();
  directory.create({ intermediates: true, idempotent: true });
  const manifest = new File(directory, `${record.id}.json`);
  if (manifest.exists || new File(directory, `${record.id}.json.bak`).exists) throw Error('A price with this ID is already saved.');
  const pending = new File(directory, `${record.id}-${randomUUID()}.pending`);
  try {
    await pending.write(JSON.stringify(record));
    // Publish only complete data and refuse to replace an existing observation.
    await pending.move(manifest, { overwrite: false });
  } finally {
    if (pending.uri !== manifest.uri && pending.exists) {
      try { pending.delete(); } catch { /* An unpublished file is ignored by readers. */ }
    }
  }
  return record;
}

export async function saveLocalPhotoReview(id: string, changes: ManualReview): Promise<SavedPriceRecord> {
  const draft = await loadSavedPriceRecord(id);
  if (!draft?.review || !reviewComplete(draft.review, draft.shop?.displayName)) throw Error('Saved product unavailable.');
  const review = { ...changes, shop: draft.review.shop };
  if (!reviewComplete(review, draft.shop?.displayName)) throw Error('Enter valid product and price details.');
  const updated = { ...draft, review };
  await writeSavedDraft(savedPhotoDirectory(), updated);
  return updated;
}

export async function loadSavedPriceRecords({ requireAll = false } = {}): Promise<SavedPriceRecord[]> {
  const directory = savedPhotoDirectory();
  if (!directory.exists) return [];
  const drafts = new Map<string, SavedPriceRecord>();
  const entries = directory.list().filter((entry): entry is File => entry instanceof File);
  // Read fallbacks first; a valid primary always wins for the same capture.
  for (const suffix of ['.json.bak', '.json']) {
    for (const entry of entries) {
      if (!entry.name.endsWith(suffix)) continue;
      const value = await readSavedDraft(entry);
      if (value && entry.name === `${value.id}${suffix}`) drafts.set(value.id, value);
    }
  }
  if (requireAll && entries.some((entry) => {
    const match = /^(.+)\.json(?:\.bak)?$/.exec(entry.name);
    return match && !drafts.has(match[1]);
  })) {
    throw Error('A saved record or photo is unreadable. Cheapo could not export the full collection.');
  }
  return [...drafts.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export async function loadLocalPhotos(): Promise<LocalPhotoDraft[]> {
  return (await loadSavedPriceRecords()).filter((record): record is LocalPhotoDraft => !!record.original);
}
