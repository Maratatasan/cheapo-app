import type { PriceObservationDetail } from '@cheapo/domain/price-history';

import type { CheapoReadSession } from '../lib/cheapo-access/client';
import { requestInterrupted } from '../lib/cheapo-access/request-deadline';
import type { CachedPricePhoto, PriceEvidenceRole, PricePhotoCache } from './cheapo-price-photo-read';
import type { ShoppingRead } from './cheapo-shopping-reads';
import { cropToPixels, type CropBox } from './crop-geometry';

type ReadPhoto = (id: string, role: PriceEvidenceRole, signal?: AbortSignal) => Promise<ShoppingRead<CachedPricePhoto>>;
export type RenderSelectedCrop = (original: CachedPricePhoto, box: CropBox) => Promise<{
  bytes: Uint8Array<ArrayBuffer>; width: number; height: number; sha256: string;
}>;

export function viewedPricePhotoRoles(observation: PriceObservationDetail): PriceObservationDetail['photos'] {
  if (observation.cropSource !== 'original') return observation.photos;
  const original = observation.photos.find(photo => photo.role === 'original');
  if (!original) return [];
  if (!observation.cropBox) return [original];
  const { width, height } = cropToPixels(observation.cropBox, original);
  return [original, { ...original, role: 'crop', width, height }];
}

export function createSelectedPricePhotoRead(
  session: Pick<CheapoReadSession, 'cacheScope' | 'assertCurrent'>,
  cache: PricePhotoCache,
  loadPhoto: ReadPhoto,
  renderCrop: RenderSelectedCrop,
) {
  return async function loadSelectedPhoto(
    observation: PriceObservationDetail, role: PriceEvidenceRole, signal?: AbortSignal,
  ): Promise<ShoppingRead<CachedPricePhoto>> {
    if (role !== 'crop' || observation.cropSource !== 'original') return loadPhoto(observation.id, role, signal);
    const box = observation.cropBox;
    if (!box || !observation.photos.some(photo => photo.role === 'original' && photo.availability !== 'pending')) {
      return { status: 'unavailable' };
    }

    const generation = cache.revision();
    function assertCurrent() {
      if (signal?.aborted || generation !== cache.revision()) throw requestInterrupted();
      session.assertCurrent();
    }
    assertCurrent();
    const original = await loadPhoto(observation.id, 'original', signal);
    assertCurrent();
    if (original.status === 'unavailable') return original;
    const key = JSON.stringify([session.cacheScope, 'derived-price-crop-v1', observation.id, observation.version,
      box.left, box.top, box.right, box.bottom, original.value.sha256]);
    const previous = await cache.read(key, generation);
    assertCurrent();
    if (previous) return { ...original, value: previous };

    const { bytes, width, height, sha256 } = await renderCrop(original.value, box);
    assertCurrent();
    const expected = cropToPixels(box, original.value);
    if (expected.width !== width || expected.height !== height) return { status: 'unavailable' };
    const result = await cache.write(key, generation, { width, height, sha256, byteCount: bytes.byteLength,
      lastSyncedAt: original.lastSyncedAt }, bytes);
    assertCurrent();
    return result ? { ...original, value: result } : { status: 'unavailable' };
  };
}
