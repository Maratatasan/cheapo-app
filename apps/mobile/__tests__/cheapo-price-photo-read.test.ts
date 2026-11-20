import { createCheapoPricePhotoRead, type CachedPricePhoto, type PricePhotoCache } from '../data/cheapo-price-photo-read';
import { createCheapoAccess } from '../lib/cheapo-access/client';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_algorithm: string, value: Uint8Array) =>
    Uint8Array.from(jest.requireActual<typeof import('node:crypto')>('node:crypto').createHash('sha256').update(value).digest()).buffer,
}));

const origin = 'https://shopping.example';
const first = `cheapo_${'A'.repeat(43)}`;
const second = `cheapo_${'B'.repeat(43)}`;
const observationId = 'fa91641f-d265-4a3b-9695-4ff553ab5138';
const path = `/v1/me/price-observations/${observationId}/photos/crop`;
const bytes = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);
const url = `https://fixture.s3.fixture-region.amazonaws.com/object?X-Amz-Signature=${'a'.repeat(64)}`;
const sha256 = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
const grant = { role: 'crop', width: 400, height: 300, byteCount: String(bytes.length), sha256, url, expiresInSeconds: 60 };
const jpegHeaders = { 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.length) };

function setup() {
  let enrollment: string | null = JSON.stringify({ origin, credential: first });
  const request = jest.fn<Promise<Response>, [string, RequestInit]>();
  const objectFetch = jest.fn<Promise<Response>, [string, RequestInit]>();
  const access = createCheapoAccess(origin, {
    getItem: async () => enrollment,
    setItem: async (_key, value) => { enrollment = value; },
    deleteItem: async () => { enrollment = null; },
  }, request, async key => key.endsWith(first) ? 'first-scope' : 'second-scope');
  let generation = 0;
  const stored = new Map<string, CachedPricePhoto>();
  const cache: PricePhotoCache = {
    revision: () => generation,
    read: async (key, revision) => revision === generation ? stored.get(key) ?? null : null,
    write: jest.fn(async (key, revision, metadata, image) => {
      if (revision !== generation) return null;
      expect(image).toEqual(bytes);
      const saved = { ...metadata, uri: 'file:///cache/checked-fixture.jpg' };
      stored.set(key, saved);
      return saved;
    }),
    remove: async (key, revision) => { if (revision === generation) stored.delete(key); },
  };
  return {
    read: createCheapoPricePhotoRead(access.openReadSession, cache, objectFetch),
    request, objectFetch, cache, stored, access,
    clear() { generation += 1; stored.clear(); },
  };
}

test('downloads one requested crop with no credentials and reopens the checked snapshot offline', async () => {
  const { read, request, objectFetch, stored, clear } = setup();
  request.mockResolvedValueOnce(Response.json(grant));
  objectFetch.mockResolvedValueOnce(new Response(bytes, { headers: jpegHeaders }));
  const fresh = await read(observationId, 'crop');
  expect(fresh).toMatchObject({ status: 'fresh', value: { uri: 'file:///cache/checked-fixture.jpg', sha256, width: 400 } });
  expect(request.mock.calls[0][0]).toBe(origin + path);
  expect(new Headers(request.mock.calls[0][1].headers).get('Authorization')).toBe(`Bearer ${first}`);
  expect(objectFetch).toHaveBeenCalledWith(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: expect.anything() });
  expect(JSON.stringify([...stored])).not.toContain(url);
  expect(JSON.stringify([...stored])).not.toContain(first);

  request.mockResolvedValueOnce(Response.json(grant));
  expect(await read(observationId, 'crop')).toEqual(fresh);
  request.mockRejectedValue(new Error('Offline'));
  expect(await read(observationId, 'crop')).toEqual({ ...fresh, status: 'cached' });
  expect(await read(observationId, 'original')).toEqual({ status: 'unavailable' });
  expect(objectFetch).toHaveBeenCalledTimes(1);
  clear();
  expect(await read(observationId, 'crop')).toEqual({ status: 'unavailable' });
});

test('rejects foreign grant targets and does not cache mismatched JPEG bytes', async () => {
  const { read, request, objectFetch, cache } = setup();
  request.mockResolvedValueOnce(Response.json({ ...grant, url: 'https://shopping.example/object' }));
  await expect(read(observationId, 'crop')).rejects.toThrow('Unreadable Cheapo photo grant');
  expect(objectFetch).not.toHaveBeenCalled();

  const changed = bytes.slice();
  changed[2] = 9;
  request.mockResolvedValueOnce(Response.json(grant));
  objectFetch.mockResolvedValueOnce(new Response(changed, { headers: jpegHeaders }));
  expect(await read(observationId, 'crop')).toEqual({ status: 'unavailable' });
  expect(cache.write).not.toHaveBeenCalled();
});

test('checks access before serving an old image and expires the old snapshot after a checked missing result', async () => {
  const { read, request, objectFetch, stored, access } = setup();
  request.mockResolvedValueOnce(Response.json(grant));
  objectFetch.mockResolvedValueOnce(new Response(bytes, { headers: jpegHeaders }));
  await read(observationId, 'crop');

  request.mockResolvedValueOnce(new Response(null, { status: 403 }));
  await expect(read(observationId, 'crop')).rejects.toThrow('Cheapo access ended');

  request.mockResolvedValueOnce(Response.json({
    householdId: '93b93988-a027-483e-8c4d-ed58a163fbfa', shopperId: 'd002d3a7-2744-4414-8336-afc644ec6878',
  }));
  await access.enroll(second);
  request.mockRejectedValueOnce(new Error('Offline'));
  expect(await read(observationId, 'crop')).toEqual({ status: 'unavailable' });
  expect(stored.size).toBe(1);

  request.mockResolvedValueOnce(Response.json(grant));
  objectFetch.mockResolvedValueOnce(new Response(bytes, { headers: jpegHeaders }));
  await read(observationId, 'crop');
  request.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(await read(observationId, 'crop')).toEqual({ status: 'unavailable' });
  expect([...stored.keys()]).toEqual([`first-scope\0${path}`]);
});

test('clearing the cache during download leaves no image from the canceled cache generation', async () => {
  const { read, request, objectFetch, stored, clear } = setup();
  request.mockResolvedValueOnce(Response.json(grant));
  objectFetch.mockImplementationOnce(async () => {
    clear();
    return new Response(bytes, { headers: jpegHeaders });
  });
  expect(await read(observationId, 'crop')).toEqual({ status: 'unavailable' });
  expect(stored.size).toBe(0);
});

test('times out a stalled object body without publishing a snapshot', async () => {
  jest.useFakeTimers();
  try {
    const { read, request, objectFetch, cache } = setup();
    request.mockResolvedValueOnce(Response.json(grant));
    objectFetch.mockResolvedValueOnce(new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }), { headers: jpegHeaders }));
    const pending = read(observationId, 'crop');
    await jest.advanceTimersByTimeAsync(55_000);
    expect(await pending).toEqual({ status: 'unavailable' });
    expect(objectFetch.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(cache.write).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
