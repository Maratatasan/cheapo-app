import { Directory, File, Paths } from 'expo-file-system';

import { emptyReview, type ManualPriceRecord } from '../data/local-photo';
import { openPriceAppendQueue, syncPriceAppends } from '../data/price-append-queue';

const mockFiles = new Map<string, string>();
let mockFailedPublication = /$a/;
let mockNextUUID = 0;
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) => require('node:crypto').createHash('sha256').update(value).digest('hex'),
  randomUUID: () => `staging-${++mockNextUUID}`,
}));
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) { this.uri = (typeof parent === 'string' ? parent : parent.uri) + (name ? '/' + name : ''); }
    get name() { return this.uri.split('/').pop()!; }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri)?.length ?? 0; }
    async move(target: File) {
      if (target.exists || mockFailedPublication.test(target.name)) throw Error('Publication interrupted.');
      mockFiles.set(target.uri, mockFiles.get(this.uri)!);
      mockFiles.delete(this.uri);
      this.uri = target.uri;
    }
    async write(value: string) { mockFiles.set(this.uri, value); }
    async text() { return mockFiles.get(this.uri); }
  }
  class Directory {
    uri: string;
    constructor(parent: string | { uri: string }, name: string) { this.uri = (typeof parent === 'string' ? parent : parent.uri) + '/' + name; }
    get exists() { return true; }
    create() {}
    list() { return [...mockFiles.keys()].filter(key => key.startsWith(this.uri + '/')).map(key => new File(key)); }
  }
  return { Directory, File, Paths: { document: 'file:///documents', cache: 'file:///cache' } };
});

const owner = {
  origin: 'https://shopping.example',
  householdId: '93b93988-a027-483e-8c4d-ed58a163fbfa',
  shopperId: 'd002d3a7-2744-4414-8336-afc644ec6878',
};
const other = { ...owner, shopperId: '64db4ca7-3962-4a16-8fee-782f26fd13b4' };
const receipt = { id: 'fa91641f-d265-4a3b-9695-4ff553ab5138', sourceId: 'price-local-01', version: 1 };
const shop = { id: 'market-01', displayName: 'Test market' };
const record: ManualPriceRecord = {
  id: receipt.sourceId, capturedAt: '2026-11-20T12:00:00.000Z', productId: 'product-01', shop,
  review: { ...emptyReview(shop.displayName), productName: 'Test rice', price: '1.20' },
};

beforeEach(() => {
  mockFiles.clear();
  mockFailedPublication = /$a/;
});

it('reopens the immutable record and operation together and rejects ID reuse with changed input', async () => {
  const queue = await openPriceAppendQueue(owner);
  const second = await openPriceAppendQueue({ ...owner });
  await Promise.all([queue.save(record), second.save({ ...record })]);
  const restarted = await openPriceAppendQueue(owner);
  const before = await restarted.read();
  expect(before).toEqual({ entries: [{ record }], recovery: [] });
  expect([...mockFiles.keys()]).toHaveLength(1);
  await expect(restarted.save({ ...record, review: { ...record.review, price: '2.00' } })).rejects.toThrow('different');
  expect(await queue.read()).toEqual(before);
});

it('keeps a partial publication visible for recovery and leaves valid work available', async () => {
  const first = await openPriceAppendQueue(owner);
  await first.save(record);
  mockFailedPublication = /^interrupted\.price\.json$/;
  await expect(first.save({ ...record, id: 'interrupted' })).rejects.toThrow('interrupted');
  const staging = [...mockFiles.keys()].find(key => key.endsWith('.pending'))!;
  mockFiles.set(staging, '{partial');
  const restarted = await openPriceAppendQueue(owner);
  expect(await restarted.read()).toEqual({ entries: [{ record }], recovery: [{ sourceId: 'interrupted', reason: 'unfinished' }] });
  expect(mockFiles.get(staging)).toBe('{partial');
  const published = [...mockFiles.keys()].find(key => key.endsWith('.price.json'))!;
  mockFiles.set(published, '{invalid');
  expect(await restarted.read()).toEqual({ entries: [], recovery: expect.arrayContaining([
    { sourceId: 'interrupted', reason: 'unfinished' }, { sourceId: record.id, reason: 'unreadable' },
  ]) });
  expect(mockFiles.get(published)).toBe('{invalid');
});

it('holds a blocked operation across rotation, preserves it across restart and retries a lost acknowledgement once', async () => {
  const original = await openPriceAppendQueue(owner);
  await original.save(record);
  const send = jest.fn().mockResolvedValue({ outcome: 'acknowledged', receipt });
  await expect(syncPriceAppends(original, { owner: other, send })).resolves.toBe('blocked');
  await expect(syncPriceAppends(original, { owner: { ...owner, origin: 'https://staging.example' }, send })).resolves.toBe('blocked');
  expect(send).not.toHaveBeenCalled();
  expect((await (await openPriceAppendQueue(other)).read()).entries).toEqual([]);
  await expect(syncPriceAppends(original, { owner, send: async () => ({ outcome: 'blocked' }) })).resolves.toBe('blocked');
  expect((await original.read()).entries).toEqual([{ record }]);

  const server = new Map<string, ManualPriceRecord>();
  const append = jest.fn(async (pending: ManualPriceRecord) => {
    if (!server.has(pending.id)) {
      server.set(pending.id, pending);
      throw Error('Network disconnected before the response.');
    }
    expect(server.get(pending.id)).toEqual(pending);
    return { outcome: 'acknowledged', receipt } as const;
  });
  await expect(syncPriceAppends(original, { owner, send: append })).resolves.toBe('failed');
  const restarted = await openPriceAppendQueue({ ...owner });
  expect((await restarted.read()).entries).toEqual([{ record }]);
  await expect(syncPriceAppends(restarted, { owner: { ...owner }, send: append })).resolves.toBe('complete');
  expect(server.size).toBe(1);
  expect(append).toHaveBeenCalledTimes(2);
  expect((await (await openPriceAppendQueue(owner)).read()).entries).toEqual([{ record, receipt }]);
  await expect(syncPriceAppends(restarted, { owner, send })).resolves.toBe('complete');
  expect(send).not.toHaveBeenCalled();
});

it('accepts only existing evidence from the protected price photo directory', async () => {
  const queue = await openPriceAppendQueue(owner);
  const asset = { uri: 'file:///cache/price-original.jpg', width: 500, height: 400, mimeType: 'image/jpeg' as const };
  mockFiles.set(asset.uri, 'cached JPEG');
  await expect(queue.save({ ...record, original: asset, selected: asset })).rejects.toThrow('protected');
  const originalFile = new File(new Directory(Paths.document, 'price-photos'), `${record.id}-original.jpg`);
  const selectedFile = new File(new Directory(Paths.document, 'price-photos'), `${record.id}-selected-123.jpg`);
  await originalFile.write('saved JPEG');
  await selectedFile.write('selected JPEG');
  const original = { ...asset, uri: originalFile.uri, size: originalFile.size };
  const selected = { ...asset, uri: selectedFile.uri, width: 230, size: selectedFile.size };
  const cropBox = { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 };
  const photoRecord = { ...record, original, selected, cropBox };
  await expect(queue.save(photoRecord)).resolves.toBeUndefined();
  expect((await queue.read()).entries).toEqual([{ record: photoRecord }]);
  expect(mockFiles.get(original.uri)).toBe('saved JPEG');
  expect(mockFiles.get(selected.uri)).toBe('selected JPEG');
});

it('retries an interrupted acknowledgement and preserves the local price and its source ID', async () => {
  const queue = await openPriceAppendQueue(owner);
  await queue.save(record);
  const session = { owner, send: jest.fn().mockResolvedValue({ outcome: 'acknowledged', receipt }) };
  mockFailedPublication = /\.receipt\.json$/;
  await expect(syncPriceAppends(queue, session)).resolves.toBe('failed');
  const restarted = await openPriceAppendQueue(owner);
  expect(await restarted.read()).toEqual({ entries: [{ record }], recovery: [{ sourceId: record.id, reason: 'unfinished' }] });
  mockFailedPublication = /$a/;
  await expect(syncPriceAppends(restarted, session)).resolves.toBe('complete');
  expect(await restarted.read()).toEqual({ entries: [{ record, receipt }], recovery: [] });
  expect(session.send.mock.calls).toEqual([[record], [record]]);
});
