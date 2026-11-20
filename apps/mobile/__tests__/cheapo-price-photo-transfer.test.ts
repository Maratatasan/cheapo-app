import { CheapoAccessError } from '../lib/cheapo-access/client';
import { describePriceEvidence, transferPricePhoto } from '../data/cheapo-price-photo-transfer';
import type { LocalPhotoDraft } from '../data/local-photo';

const mockFiles = new Map<string, Uint8Array<ArrayBuffer>>();
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_algorithm: string, value: Uint8Array) =>
    Uint8Array.from(require('node:crypto').createHash('sha256').update(value).digest()).buffer,
}));
jest.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  Directory: class Directory {
    uri: string;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
  },
  File: class File {
    uri: string;
    constructor(parent: { uri: string }, name: string) { this.uri = `${parent.uri}/${name}`; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.byteLength ?? 0; }
    async bytes() { return mockFiles.get(this.uri)?.slice(); }
  },
}));

const receipt = { id: 'fa91641f-d265-4a3b-9695-4ff553ab5138', sourceId: 'price-local-01' };
const original = { uri: 'file:///documents/price-photos/price-local-01-original.jpg', width: 800, height: 600, mimeType: 'image/jpeg' as const };
const crop = { ...original, uri: 'file:///documents/price-photos/price-local-01-selected-123.jpg', width: 400, height: 300 };
const record: LocalPhotoDraft = { id: receipt.sourceId, capturedAt: '2026-01-01T00:00:00Z', original, selected: crop };
const originalBytes = new Uint8Array([255, 216, 1, 2, 3, 255, 217]);
const cropBytes = new Uint8Array([255, 216, 4, 5, 255, 217]);
const originalHash = require('node:crypto').createHash('sha256').update(originalBytes).digest('hex');
const checksum = require('node:crypto').createHash('sha256').update(originalBytes).digest('base64');
const apiPath = `/v1/me/price-observations/${receipt.id}/photos/original/upload`;
const intent = { ...original, sourceId: receipt.sourceId, observationId: receipt.id, role: 'original' as const, byteCount: originalBytes.length, sha256: originalHash };
const signedHeaders = {
  'Content-Length': String(originalBytes.length), 'Content-Type': 'image/jpeg',
  'If-None-Match': '*', 'x-amz-checksum-sha256': checksum,
};
const grant = {
  role: 'original', availability: 'pending', expiresInSeconds: 120,
  url: `https://fixture.s3.fixture-region.amazonaws.com/photo?X-Amz-Signature=${'a'.repeat(64)}`,
  headers: signedHeaders,
};
const available = { role: 'original', availability: 'available' };
const json = (value: unknown, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => value }) as Response;

beforeEach(() => {
  mockFiles.clear();
  mockFiles.set(original.uri, originalBytes);
  mockFiles.set(crop.uri, cropBytes);
});

it('binds the original and crop to the matching receipt using the protected file bytes', async () => {
  const photos = await describePriceEvidence(record, receipt);
  expect(photos).toEqual([
    { uri: original.uri, width: 800, height: 600, sourceId: record.id, observationId: receipt.id, role: 'original', byteCount: 7, sha256: originalHash },
    { uri: crop.uri, width: 400, height: 300, sourceId: record.id, observationId: receipt.id, role: 'crop', byteCount: 6, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
  ]);
  expect(photos[1].sha256).not.toBe(photos[0].sha256);
  expect(await describePriceEvidence({ ...record, selected: original }, receipt)).toEqual([photos[0]]);
  await expect(describePriceEvidence(record, { ...receipt, sourceId: 'another-price' })).rejects.toThrow('acknowledgement');
  await expect(describePriceEvidence({ ...record, original: { ...original, uri: original.uri.replace('/documents/', '/cache/') } }, receipt)).rejects.toThrow('saved photo');
});

it('prepares metadata, uploads exact bytes without Cheapo credentials, then verifies', async () => {
  const request = jest.fn().mockResolvedValueOnce(json({ ...grant, headers: { ...signedHeaders, Authorization: 'ignored' } })).mockResolvedValueOnce(json(available));
  const objectFetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  const assertCurrent = jest.fn();
  await expect(transferPricePhoto(intent, { request, assertCurrent }, undefined, objectFetch)).resolves.toBe('available');
  expect(request.mock.calls.map(([path, options]) => [path, options.method, options.body])).toEqual([
    [apiPath, 'PUT', JSON.stringify({ sha256: originalHash, byteCount: 7, width: 800, height: 600 })],
    [apiPath, 'POST', undefined],
  ]);
  expect(objectFetch).toHaveBeenCalledWith(grant.url, {
    method: 'PUT', body: originalBytes, headers: signedHeaders, redirect: 'error', credentials: 'omit', signal: expect.anything(),
  });
  expect(request.mock.invocationCallOrder[0]).toBeLessThan(objectFetch.mock.invocationCallOrder[0]);
  expect(objectFetch.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[1]);
  expect(assertCurrent).toHaveBeenCalled();
});

it('re-verifies an existing conditional upload and accepts a recovered verification acknowledgement', async () => {
  const request = jest.fn().mockResolvedValueOnce(json(grant)).mockResolvedValueOnce(json({ role: 'original', availability: 'pending' }))
    .mockResolvedValueOnce(json(grant)).mockResolvedValueOnce(json(available)).mockResolvedValueOnce(json(available));
  const session = { request, assertCurrent: jest.fn() };
  const objectFetch = jest.fn().mockResolvedValue({ ok: false, status: 412 });
  await expect(transferPricePhoto(intent, session, undefined, objectFetch)).resolves.toBe('retry');
  await expect(transferPricePhoto(intent, session, undefined, objectFetch)).resolves.toBe('available');
  mockFiles.delete(original.uri);
  await expect(transferPricePhoto(intent, session, undefined, objectFetch)).resolves.toBe('available');
  expect(objectFetch).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.map(([, init]) => init.method)).toEqual(['PUT', 'POST', 'PUT', 'POST', 'PUT']);
});

it('blocks foreign targets, wrong roles and wrong signed lengths without sending bytes', async () => {
  const request = jest.fn().mockResolvedValueOnce(json({ ...grant, url: 'https://example.org/photo' }))
    .mockResolvedValueOnce(json({ ...grant, role: 'crop' }))
    .mockResolvedValueOnce(json({ ...grant, headers: { ...signedHeaders, 'Content-Length': '100' } }));
  const objectFetch = jest.fn();
  const session = { request, assertCurrent: jest.fn() };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(transferPricePhoto(intent, session, undefined, objectFetch)).resolves.toBe('blocked');
  }
  expect(objectFetch).not.toHaveBeenCalled();
});

it('retains a recoverable intent when its saved bytes are missing or changed', async () => {
  const session = { request: jest.fn().mockResolvedValue(json(grant)), assertCurrent: jest.fn() };
  const objectFetch = jest.fn();
  mockFiles.delete(original.uri);
  await expect(transferPricePhoto(intent, session, undefined, objectFetch)).resolves.toBe('local-photo-unavailable');
  const changed = new Uint8Array(originalBytes);
  changed[2] = 8;
  mockFiles.set(original.uri, changed);
  await expect(transferPricePhoto(intent, session, undefined, objectFetch)).resolves.toBe('local-photo-unavailable');
  expect(mockFiles.get(original.uri)).toEqual(changed);
  expect(objectFetch).not.toHaveBeenCalled();
});

it('drops a grant if the enrollment changes before the object request', async () => {
  const session = { request: jest.fn().mockResolvedValue(json(grant)), assertCurrent: jest.fn()
    .mockImplementationOnce(() => {}).mockImplementationOnce(() => {})
    .mockImplementation(() => { throw new CheapoAccessError('Enrollment changed.'); }) };
  const objectFetch = jest.fn();
  await expect(transferPricePhoto(intent, session, undefined, objectFetch)).resolves.toBe('blocked');
  expect(objectFetch).not.toHaveBeenCalled();
});

it('bounds an unfinished API response body and aborts an in-flight object upload', async () => {
  jest.useFakeTimers();
  try {
    const request = jest.fn().mockResolvedValueOnce({ ...json(grant), json: () => new Promise(() => {}) })
      .mockResolvedValueOnce(json(grant));
    const controller = new AbortController();
    const objectFetch = jest.fn(() => {
      controller.abort();
      return new Promise<Response>(() => {});
    });
    const session = { request, assertCurrent: jest.fn() };
    const waiting = transferPricePhoto(intent, session, undefined, objectFetch);
    await jest.advanceTimersByTimeAsync(35_000);
    await expect(waiting).resolves.toBe('retry');
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    await expect(transferPricePhoto(intent, session, controller.signal, objectFetch)).resolves.toBe('retry');
    expect(objectFetch).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});
