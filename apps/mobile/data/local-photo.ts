import type { CropBox } from './crop-geometry';
import { Directory, File, Paths } from 'expo-file-system';

export type PhotoAsset = { uri: string; width: number; height: number; mimeType: 'image/jpeg'; size?: number };
export type ManualReview = { productName: string; price: string; currency: string; shop: string; unitPrice: string; unit: string };
export const emptyReview = (shop = ''): ManualReview => ({ productName: '', price: '', currency: 'GBP', shop, unitPrice: '', unit: '' });
const validPrice = (value: string, fraction = 2) => new RegExp(`^\\d+(\\.\\d{1,${fraction}})?$`).test(value.trim()) && value.length <= 24 && Number(value) > 0 && Number(value) <= 9999999.99;
export function reviewComplete(review?: ManualReview): boolean {
  return !!review && !!review.productName.trim() && review.productName.trim().length <= 200 && !!review.shop.trim() && review.shop.trim().length <= 150 && validPrice(review.price) && /^[A-Z]{3}$/.test(review.currency) && ((!review.unitPrice.trim() && !review.unit.trim()) || (validPrice(review.unitPrice, 6) && !!review.unit.trim() && review.unit.trim().length <= 30));
}
export type LocalPhotoDraft = { id: string; capturedAt: string; original: PhotoAsset; selected: PhotoAsset; review?: ManualReview; cropBox?: CropBox };
export async function localPhotoSource(asset: PhotoAsset): Promise<PhotoAsset> {
  if (!/^https?:/.test(asset.uri)) return asset;
  // Explicit development fixture selection may start as a remote JPEG.
  const file = await File.downloadFileAsync(asset.uri, new File(Paths.cache, `fixture-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`));
  return { ...asset, uri: file.uri, size: file.size };
}
const folder = () => new Directory(Paths.document, 'price-photos');

// A manifest is published only after both image files have been copied and checked.
export async function saveLocalPhoto(draft: LocalPhotoDraft): Promise<LocalPhotoDraft> {
  const directory = folder();
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
  const manifest = new File(directory, `${draft.id}.json`);
  const previous = await readSavedDraft(manifest);
  // Never overwrite the last good fallback with an interrupted/invalid primary.
  // If making the safety copy fails, the primary has not been touched.
  if (previous) await new File(directory, `${draft.id}.json.bak`).write(JSON.stringify(previous));
  await manifest.write(JSON.stringify(saved));
  return saved;
}

function validSavedDraft(value: unknown): value is LocalPhotoDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as LocalPhotoDraft;
  const asset = (photo: PhotoAsset) => photo && typeof photo.uri === 'string' && photo.uri.startsWith('file:') && photo.mimeType === 'image/jpeg' && Number.isFinite(photo.width) && photo.width > 0 && Number.isFinite(photo.height) && photo.height > 0;
  if (typeof draft.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(draft.id) || typeof draft.capturedAt !== 'string' || !Number.isFinite(Date.parse(draft.capturedAt)) || !asset(draft.original) || !asset(draft.selected)) return false;
  if (draft.review !== undefined && (!draft.review || !Object.keys(emptyReview()).every(key => typeof draft.review?.[key as keyof ManualReview] === 'string'))) return false;
  const box = draft.cropBox;
  if (box !== undefined && (!box || ![box.left, box.top, box.right, box.bottom].every(value => Number.isFinite(value) && value >= 0 && value <= 1) || box.left >= box.right || box.top >= box.bottom)) return false;
  return true;
}

async function readSavedDraft(file: File): Promise<LocalPhotoDraft | null> {
  try {
    if (!file.exists) return null;
    const value: unknown = JSON.parse(await file.text());
    return validSavedDraft(value) && new File(value.original.uri).exists && new File(value.selected.uri).exists ? value : null;
  } catch { return null; }
}

export async function loadLocalPhotos(): Promise<LocalPhotoDraft[]> {
  const directory = folder();
  if (!directory.exists) return [];
  const drafts = new Map<string, LocalPhotoDraft>();
  const entries = directory.list().filter((entry): entry is File => entry instanceof File);
  // Read fallbacks first; a valid primary always wins for the same capture.
  for (const suffix of ['.json.bak', '.json']) {
    for (const entry of entries) {
      if (!entry.name.endsWith(suffix)) continue;
      const value = await readSavedDraft(entry);
      if (value && entry.name === `${value.id}${suffix}`) drafts.set(value.id, value);
    }
  }
  return [...drafts.values()].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}
