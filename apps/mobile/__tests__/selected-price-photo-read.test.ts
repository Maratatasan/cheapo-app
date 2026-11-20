import type { PriceObservationDetail } from '@cheapo/domain/price-history';

import type { CachedPricePhoto, PriceEvidenceRole, PricePhotoCache } from '../data/cheapo-price-photo-read';
import { createSelectedPricePhotoRead, viewedPricePhotoRoles } from '../data/selected-price-photo-read';

const id = 'fa91641f-d265-4a3b-9695-4ff553ab5138';
const time = '2026-11-19T12:00:00.000000Z';
const original: CachedPricePhoto = { sha256: 'a'.repeat(64), byteCount: 4, width: 1200, height: 800,
  uri: 'file:///verified-original.jpg', lastSyncedAt: time };
const observation: PriceObservationDetail = {
  id, sourceId: 'local-price', ownedByCurrentShopper: false, version: 4, capturedAt: time, productId: null, sourceProductId: null,
  productName: 'Sample rice', shopId: 'shop-1', sourceShopId: null, shopDisplayName: 'Sample shop',
  review: null, priceAmount: '1.75', currency: 'GBP', unitPrice: null, selectedPhotoRole: 'crop', cropSource: 'original',
  cropBox: { left: .25, top: .25, right: .75, bottom: .75 }, photos: [
    { role: 'original', width: 1200, height: 800 }, { role: 'crop', width: 500, height: 300 },
  ],
};

function setup() {
  let revision = 0;
  const photos = new Map<string, CachedPricePhoto>();
  const cache: PricePhotoCache = {
    revision: () => revision,
    read: async key => photos.get(key) ?? null,
    write: jest.fn(async (key, generation, metadata) => {
      if (generation !== revision) return null;
      const photo = { ...metadata, uri: 'file:///replaceable-derived.jpg' };
      photos.set(key, photo);
      return photo;
    }),
    remove: async key => { photos.delete(key); },
  };
  const loadPhoto = jest.fn(async (_id: string, _role: PriceEvidenceRole) => ({ status: 'cached' as const, value: original, lastSyncedAt: time }));
  const render = jest.fn(async () => ({ sha256: 'b'.repeat(64), width: 600, height: 400, bytes: new Uint8Array([1, 2, 3]) }));
  const view = (scope = 'phone-scope-one') => createSelectedPricePhotoRead({ cacheScope: scope, assertCurrent() {} }, cache, loadPhoto, render);
  return { cache, loadPhoto, photos, render, view, clear() { revision += 1; photos.clear(); } };
}

test('uses the verified original for a revised crop and isolates derived files by owner and version', async () => {
  const { view, render, loadPhoto, photos } = setup();
  const read = view();
  expect(viewedPricePhotoRoles(observation)).toEqual([
    { role: 'original', width: 1200, height: 800 }, { role: 'crop', width: 600, height: 400 },
  ]);
  expect(await read(observation, 'crop')).toMatchObject({ status: 'cached', value: { uri: 'file:///replaceable-derived.jpg' } });
  expect(await read(observation, 'crop', undefined, 'cache-only')).toMatchObject({
    status: 'cached', value: { uri: 'file:///replaceable-derived.jpg' },
  });
  expect(await read({ ...observation, version: 5 }, 'crop', undefined, 'cache-only')).toEqual({ status: 'unavailable' });
  expect(loadPhoto).toHaveBeenLastCalledWith(id, 'original', undefined, 'cache-only');
  expect(render).toHaveBeenCalledTimes(1);
  expect(render).toHaveBeenCalledWith(original, observation.cropBox);
  await read({ ...observation, version: 5 }, 'crop');
  await view('phone-scope-two')(observation, 'crop');
  expect(photos.size).toBe(3);
  expect(loadPhoto.mock.calls.every(call => call[1] === 'original')).toBe(true);
});

test('never uses the older crop for a revised crop if original is pending, reverted, or denied', async () => {
  const { view, loadPhoto, render } = setup();
  const read = view();
  const held: PriceObservationDetail = { ...observation,
    photos: [{ role: 'original', width: 1200, height: 800, availability: 'pending' }, observation.photos[1]] };
  expect(viewedPricePhotoRoles(held)[1]).toMatchObject({ role: 'crop', availability: 'pending' });
  expect(await read(held, 'crop')).toEqual({ status: 'unavailable' });
  const reverted: PriceObservationDetail = { ...observation, cropBox: null, selectedPhotoRole: 'original' };
  expect(viewedPricePhotoRoles(reverted)).toEqual([observation.photos[0]]);
  expect(await read(reverted, 'crop')).toEqual({ status: 'unavailable' });
  expect(loadPhoto).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
  await read(observation, 'crop');
  loadPhoto.mockRejectedValueOnce(Error('Cheapo access ended'));
  await expect(read(observation, 'crop')).rejects.toThrow('Cheapo access ended');
  expect(render).toHaveBeenCalledTimes(1);
});

test('discards a render which completes after the user clears the replaceable cache', async () => {
  const { view, render, photos, cache, clear } = setup();
  const old = Promise.withResolvers<Awaited<ReturnType<typeof render>>>();
  const started = Promise.withResolvers<void>();
  render.mockImplementationOnce(() => { started.resolve(); return old.promise; });
  const read = view()(observation, 'crop');
  await started.promise;
  clear();
  old.resolve({ sha256: 'b'.repeat(64), width: 600, height: 400, bytes: new Uint8Array([1, 2, 3]) });
  await expect(read).rejects.toThrow();
  expect(cache.write).not.toHaveBeenCalled();
  expect(photos.size).toBe(0);
});
