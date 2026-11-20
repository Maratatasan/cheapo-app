import { createProductPresentationPhotos } from '../data/product-presentation-photos';
import type { CachedPricePhoto, PricePhotoCache } from '../data/cheapo-price-photo-read';
import { CheapoAccessError, createCheapoAccess } from '../lib/cheapo-access/client';

const mockImage = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ exists: true, size: mockImage.byteLength, bytes: async () => mockImage.slice() })),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => 'product-photo-operation',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_algorithm: string, value: Uint8Array) =>
    Uint8Array.from(jest.requireActual<typeof import('node:crypto')>('node:crypto').createHash('sha256').update(value).digest()).buffer,
}));

const origin = 'https://shopping.example';
const bearer = `cheapo_${'C'.repeat(43)}`;
const identity = { householdId: '93b93988-a027-483e-8c4d-ed58a163fbfa', shopperId: 'd002d3a7-2744-4414-8336-afc644ec6878' };
const owner = { origin, ...identity };
const productId = 'exact-fixture';
const path = `/v1/products/${productId}/presentation-photo`;
const url = `https://fixture.s3.fixture-region.amazonaws.com/product-presentation/5353588d-923b-4f09-903d-f72adeaded5a.jpg?X-Amz-Signature=${'a'.repeat(64)}`;
const sha256 = require('node:crypto').createHash('sha256').update(mockImage).digest('hex');
const metadata = { sha256, byteCount: mockImage.byteLength, width: 80, height: 60 };
const grant = { ...metadata, version: 1, url, expiresInSeconds: 60 };
const jpegHeaders = { 'Content-Type': 'image/jpeg', 'Content-Length': String(mockImage.byteLength) };
const signedHeaders = { ...jpegHeaders, 'If-None-Match': '*', 'x-amz-checksum-sha256': Buffer.from(sha256, 'hex').toString('base64') };
const uploadGrant = { availability: 'pending', url, headers: { ...signedHeaders, Authorization: 'not-an-object-header' }, expiresInSeconds: 120 };
const asset = { uri: 'file:///explicitly-chosen-product.jpg', width: 80, height: 60, mimeType: 'image/jpeg' } as const;

function setup() {
  let enrollment: string | null = JSON.stringify({ origin, credential: bearer, identity });
  let revision = 0;
  const objects = new Map<string, CachedPricePhoto>();
  const accessRequest = jest.fn<Promise<Response>, [string, RequestInit]>();
  const objectFetch = jest.fn<Promise<Response>, [string, RequestInit]>();
  const access = createCheapoAccess(origin, {
    getItem: async () => enrollment,
    setItem: async (_key, value) => { enrollment = value; },
    deleteItem: async () => { enrollment = null; },
  }, (target, request) => target === `${origin}/v1/me` ? Promise.resolve(Response.json(identity)) : accessRequest(target, request),
  async key => key.endsWith(bearer) ? 'fixture-scope' : 'other-scope');
  const cache: PricePhotoCache = {
    revision: () => revision,
    read: async (key, expected) => expected === revision ? objects.get(key) ?? null : null,
    write: jest.fn(async (key, expected, metadata, bytes) => {
      if (expected !== revision) return null;
      expect(bytes).toEqual(mockImage);
      const value = { ...metadata, uri: `file:///cache/verified-${metadata.version}.jpg` };
      objects.set(key, value);
      return value;
    }),
    remove: async (key, expected) => { if (expected === revision) objects.delete(key); },
  };
  const inputs = { owner, openRead: access.openReadSession, openWrite: access.openShoppingWriteSession, cache, objectFetch };
  return { ...inputs, accessRequest, access, objects, photos: createProductPresentationPhotos(inputs),
    clear() { revision++; objects.clear(); } };
}

test('reads a checked version, reuses the exact bytes and keeps owners and products separate', async () => {
  const { photos, accessRequest, objectFetch, objects, access } = setup();
  accessRequest.mockResolvedValueOnce(Response.json(grant));
  objectFetch.mockResolvedValueOnce(new Response(mockImage, { headers: jpegHeaders }));
  const original = await photos.read(productId);
  expect(original).toMatchObject({ status: 'fresh', photo: { ...metadata, version: 1, uri: 'file:///cache/verified-1.jpg' } });
  expect(accessRequest.mock.calls[0][0]).toBe(origin + path);
  expect(objectFetch).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'error' }));
  expect(JSON.stringify([...objects])).not.toContain(url);
  expect(JSON.stringify([...objects])).not.toContain(bearer);

  accessRequest.mockResolvedValueOnce(Response.json(grant));
  expect(await photos.read(productId)).toEqual(original);
  expect(await photos.read(productId, undefined, 'cache-only')).toEqual({ ...original, status: 'cached' });
  expect(await photos.read('another-exact-variant', undefined, 'cache-only')).toEqual({ status: 'unavailable' });
  expect(accessRequest).toHaveBeenCalledTimes(2);
  expect(objectFetch).toHaveBeenCalledTimes(1);

  accessRequest.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(photos.read(productId)).rejects.toBeInstanceOf(CheapoAccessError);
  await access.enroll(`cheapo_${'D'.repeat(43)}`);
  expect(await photos.read(productId, undefined, 'cache-only')).toEqual({ status: 'unavailable' });
});

test('uses a private signed upload, replays lost confirmation and caches only accepted bytes', async () => {
  const { photos, accessRequest, objectFetch, cache } = setup();
  const plan = await photos.prepare(productId, 0, asset);
  expect(plan).toEqual({ productId, operationId: 'product-photo-operation', expectedVersion: 0, ...metadata });
  expect(accessRequest).not.toHaveBeenCalled();
  accessRequest.mockResolvedValueOnce(Response.json(uploadGrant)).mockRejectedValueOnce(Error('Lost confirmation'));
  objectFetch.mockResolvedValueOnce(new Response(null, { status: 412 }));
  expect(await photos.replace(plan)).toEqual({ status: 'retry' });
  expect(cache.write).not.toHaveBeenCalled();
  expect(objectFetch).toHaveBeenCalledWith(url, { method: 'PUT', body: mockImage, headers: signedHeaders,
    credentials: 'omit', redirect: 'error', signal: expect.anything() });
  const [[prepareUrl, prepare], [confirmUrl, confirm]] = accessRequest.mock.calls;
  expect(prepareUrl).toBe(`${origin}${path}/upload`);
  expect(confirmUrl).toBe(prepareUrl);
  expect(JSON.parse(String(prepare.body))).toEqual({ expectedVersion: 0, operationId: plan.operationId, ...metadata });
  expect(JSON.parse(String(confirm.body))).toEqual({ operationId: plan.operationId });

  accessRequest.mockResolvedValueOnce(Response.json({ availability: 'available', version: 1 }));
  expect(await photos.replace(plan)).toEqual({ status: 'available', version: 1 });
  expect(objectFetch).toHaveBeenCalledTimes(1);
  expect(await photos.read(productId, undefined, 'cache-only')).toMatchObject({ status: 'cached', photo: { version: 1 } });
});

test('retains the old photo on conditional conflict and rejects wrong scope and object URL', async () => {
  const setupResult = setup();
  const { photos, accessRequest, objectFetch, cache } = setupResult;
  accessRequest.mockResolvedValueOnce(Response.json(grant));
  objectFetch.mockResolvedValueOnce(new Response(mockImage, { headers: jpegHeaders }));
  const previous = await photos.read(productId);
  const plan = await photos.prepare(productId, 1, asset);
  accessRequest.mockResolvedValueOnce(Response.json({ error: 'photo_version_conflict', currentVersion: 2 }, { status: 409 }));
  expect(await photos.replace(plan)).toEqual({ status: 'conflict', currentVersion: 2 });
  expect(await photos.read(productId, undefined, 'cache-only')).toEqual({ ...previous, status: 'cached' });

  accessRequest.mockResolvedValueOnce(Response.json({ ...uploadGrant, url: url.replace('product-presentation', 'price-evidence') }));
  expect(await photos.replace(plan)).toEqual({ status: 'blocked' });
  expect(cache.write).toHaveBeenCalledTimes(1);
  expect(objectFetch).toHaveBeenCalledTimes(1);
  const other = createProductPresentationPhotos({ ...setupResult, owner: { ...owner, shopperId: 'foreign-shopper' } });
  const otherPlan = await other.prepare(productId, 1, asset);
  await expect(other.replace(otherPlan)).rejects.toBeInstanceOf(CheapoAccessError);
  expect(await other.replace(plan)).toEqual({ status: 'blocked' });
  await expect(photos.prepare(productId, 1, { ...asset, width: 4097 })).rejects.toThrow('4096 pixels');
});

test('a download that completes after Clear cache cannot recreate the old snapshot', async () => {
  const { photos, accessRequest, objectFetch, cache, clear } = setup();
  accessRequest.mockResolvedValueOnce(Response.json(grant));
  const object = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  objectFetch.mockImplementationOnce(() => { started.resolve(); return object.promise; });
  const reading = photos.read(productId);
  await started.promise;
  clear();
  object.resolve(new Response(mockImage, { headers: jpegHeaders }));
  await expect(reading).rejects.toThrow('Cheapo request interrupted');
  expect(cache.write).not.toHaveBeenCalled();
});

test('keeps the checked image on a failed refresh but clears a checked missing product photo', async () => {
  const { photos, accessRequest, objectFetch } = setup();
  accessRequest.mockResolvedValueOnce(Response.json(grant));
  objectFetch.mockResolvedValueOnce(new Response(mockImage, { headers: jpegHeaders }));
  const previous = await photos.read(productId);

  accessRequest.mockResolvedValueOnce(Response.json({ ...grant, version: 2, sha256: 'b'.repeat(64) }));
  objectFetch.mockResolvedValueOnce(new Response(mockImage, { headers: jpegHeaders }));
  expect(await photos.read(productId)).toEqual({ ...previous, status: 'cached' });
  accessRequest.mockResolvedValueOnce(Response.json({ error: 'not_found' }, { status: 404 }));
  expect(await photos.read(productId)).toEqual({ ...previous, status: 'cached' });
  accessRequest.mockResolvedValueOnce(Response.json({ error: 'photo_not_found' }, { status: 404 }));
  expect(await photos.read(productId)).toEqual({ status: 'missing' });
  expect(await photos.read(productId, undefined, 'cache-only')).toEqual({ status: 'unavailable' });
});
