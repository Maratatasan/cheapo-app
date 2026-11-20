import { Directory, File, Paths } from 'expo-file-system';

import { emptyReview, type ManualPriceRecord } from '../data/local-photo';
import { openPriceAppendQueue } from '../data/price-append-queue';
import { createPriceAppendSync } from '../data/price-append-sync';
import { createPriceRecords } from '../data/price-records';

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
const body = JSON.stringify({
  sourceId: record.id, capturedAt: record.capturedAt, productId: record.productId,
  shopId: shop.id, shopDisplayName: shop.displayName,
  review: { productName: 'Test rice', price: '1.20', currency: 'GBP' }, unitPrice: null,
});

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
  expect(before).toEqual({ entries: [{ record, body }], recovery: [] });
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
  expect(await restarted.read()).toEqual({ entries: [{ record, body }], recovery: [{ sourceId: 'interrupted', reason: 'unfinished' }] });
  expect(mockFiles.get(staging)).toBe('{partial');
  const published = [...mockFiles.keys()].find(key => key.endsWith('.price.json'))!;
  mockFiles.set(published, '{invalid');
  expect(await restarted.read()).toEqual({ entries: [], recovery: expect.arrayContaining([
    { sourceId: 'interrupted', reason: 'unfinished' }, { sourceId: record.id, reason: 'unreadable' },
  ]) });
  expect(mockFiles.get(published)).toBe('{invalid');
  await expect(createPriceRecords(restarted).loadAll({ requireAll: true })).rejects.toThrow('full collection');
});

it('holds a blocked operation across rotation, preserves it across restart and retries a lost acknowledgement once', async () => {
  const original = await openPriceAppendQueue(owner);
  await original.save(record);
  const post = jest.fn(async () => Response.json(receipt));
  await expect(createPriceAppendSync(original, async () => ({ owner: other, post }))()).resolves.toBe('blocked');
  await expect(createPriceAppendSync(original, async () => ({ owner: { ...owner, origin: 'https://staging.example' }, post }))()).resolves.toBe('blocked');
  expect(post).not.toHaveBeenCalled();
  expect((await (await openPriceAppendQueue(other)).read()).entries).toEqual([]);
  await expect(createPriceAppendSync(original, async () => ({ owner, post: async () => new Response(null, { status: 403 }) }))()).resolves.toBe('blocked');
  expect((await original.read()).entries).toEqual([{ record, body }]);

  // An older serializer can produce valid JSON with different formatting.
  // A retry must use what was stored even when re-encoding would change it.
  const storageFile = [...mockFiles.keys()].find(key => key.endsWith('.price.json'))!;
  const previousBody = `${body}\n`;
  mockFiles.set(storageFile, JSON.stringify({ ...JSON.parse(mockFiles.get(storageFile)!), body: previousBody }));

  const server = new Map<string, string>();
  const append = jest.fn(async (pending: string) => {
    const { sourceId } = JSON.parse(pending);
    if (!server.has(sourceId)) {
      server.set(sourceId, pending);
      throw Error('Network disconnected before the response.');
    }
    expect(server.get(sourceId)).toBe(pending);
    return Response.json(receipt);
  });
  await expect(createPriceAppendSync(original, async () => ({ owner, post: append }))()).resolves.toBe('failed');
  const restarted = await openPriceAppendQueue({ ...owner });
  expect((await restarted.read()).entries).toEqual([{ record, body: previousBody }]);
  await expect(createPriceAppendSync(restarted, async () => ({ owner: { ...owner }, post: append }))()).resolves.toBe('complete');
  expect(server.size).toBe(1);
  expect(append.mock.calls.map(([sent]) => sent)).toEqual([previousBody, previousBody]);
  expect((await (await openPriceAppendQueue(owner)).read()).entries).toEqual([{ record, body: previousBody, receipt }]);
  const reopen = jest.fn(async () => ({ owner, post }));
  await expect(createPriceAppendSync(restarted, reopen)()).resolves.toBe('complete');
  expect(reopen).not.toHaveBeenCalled();
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
  expect((await queue.read()).entries).toEqual([{ record: photoRecord, body: JSON.stringify({ ...JSON.parse(body), cropBox }) }]);
  expect(mockFiles.get(original.uri)).toBe('saved JPEG');
  expect(mockFiles.get(selected.uri)).toBe('selected JPEG');
});

it('retries an interrupted acknowledgement and preserves the local price and its source ID', async () => {
  const queue = await openPriceAppendQueue(owner);
  await queue.save(record);
  const session = { owner, post: jest.fn(async () => Response.json(receipt)) };
  mockFailedPublication = /\.receipt\.json$/;
  await expect(createPriceAppendSync(queue, async () => session)()).resolves.toBe('failed');
  const restarted = await openPriceAppendQueue(owner);
  expect(await restarted.read()).toEqual({ entries: [{ record, body }], recovery: [{ sourceId: record.id, reason: 'unfinished' }] });
  mockFailedPublication = /$a/;
  await expect(createPriceAppendSync(restarted, async () => session)()).resolves.toBe('complete');
  expect(await restarted.read()).toEqual({ entries: [{ record, body, receipt }], recovery: [] });
  expect(session.post.mock.calls).toEqual([[body, expect.any(AbortSignal)], [body, expect.any(AbortSignal)]]);
});

it('aborts a stalled write and lets the shopper retry the same durable request', async () => {
  jest.useFakeTimers();
  try {
    const queue = await openPriceAppendQueue(owner);
    await queue.save(record);
    let start!: (signal: AbortSignal | undefined) => void;
    const sending = new Promise<AbortSignal | undefined>(resolve => { start = resolve; });
    const post = jest.fn<Promise<Response>, [string, AbortSignal?]>()
      .mockImplementationOnce((_body, signal) => {
        start(signal);
        return new Promise(() => {});
      })
      .mockImplementation(async () => Response.json(receipt));
    const sync = createPriceAppendSync(queue, async () => ({ owner, post }));
    const stalled = sync();
    const signal = await sending;
    await jest.advanceTimersByTimeAsync(44_999);
    expect(signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(signal?.aborted).toBe(true);
    await expect(stalled).resolves.toBe('failed');
    expect(post).toHaveBeenCalledTimes(1);
    expect(await queue.read()).toEqual({ entries: [{ record, body }], recovery: [] });
    await expect(sync()).resolves.toBe('complete');
    expect(post.mock.calls.map(([sent]) => sent)).toEqual([body, body]);
    expect(await queue.read()).toEqual({ entries: [{ record, body, receipt }], recovery: [] });
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

it('serializes an explicit shelf unit-price pair before sending', async () => {
  const queue = await openPriceAppendQueue(owner);
  await queue.save({ ...record, review: { ...record.review, unitPrice: ' 2.050 ', unit: ' 100 g ' } });
  const stored = (await queue.read()).entries[0];
  expect(JSON.parse(stored.body ?? '')).toMatchObject({
    review: { unitPrice: '2.050', unit: '100 g' }, unitPrice: { amount: 2.05, unit: '100 g' },
  });
});

it('runs another pass when a new save asks to sync during an active pass', async () => {
  const queue = await openPriceAppendQueue(owner);
  await queue.save(record);
  const next = { ...record, id: 'price-local-02' };
  let release!: (response: Response) => void;
  let sending!: () => void;
  const started = new Promise<void>(resolve => { sending = resolve; });
  const post = jest.fn<Promise<Response>, [string]>()
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; sending(); }))
    .mockImplementation(async () => Response.json({ ...receipt, sourceId: next.id }));
  const sync = createPriceAppendSync(queue, async () => ({ owner, post }));
  const firstPass = sync();
  await started;
  await queue.save(next);
  const requestedPass = sync();
  release(Response.json(receipt, { status: 201 }));
  await expect(firstPass).resolves.toBe('complete');
  await expect(requestedPass).resolves.toBe('complete');
  expect(post.mock.calls.map(([pending]) => JSON.parse(pending).sourceId)).toEqual([record.id, next.id]);
  expect((await queue.read()).entries.every(entry => entry.receipt)).toBe(true);
});

it('reads local and queued prices together without exposing another shopper’s pending prices', async () => {
  const queue = await openPriceAppendQueue(owner);
  const local = createPriceRecords(null);
  const enrolled = createPriceRecords(queue);
  const legacy = { ...record, id: 'legacy', capturedAt: '2026-11-19T12:00:00.000Z' };
  await local.saveManual(legacy);
  await enrolled.saveManual(record);
  const reopened = createPriceRecords(await openPriceAppendQueue(owner));
  expect(await reopened.loadAll()).toEqual([record, legacy]);
  expect(await reopened.load(record.id)).toEqual(record);
  expect(await reopened.load(legacy.id)).toEqual(legacy);
  expect(await createPriceRecords(await openPriceAppendQueue(other)).loadAll()).toEqual([legacy]);
  expect(await local.loadAll()).toEqual([legacy]);
  await expect(enrolled.saveManual(legacy)).rejects.toThrow('already saved');
  expect((await queue.read()).entries).toEqual([{ record, body }]);
});

it('keeps a committed price readable when its request or acknowledgement needs recovery', async () => {
  const queue = await openPriceAppendQueue(owner);
  const prices = createPriceRecords(queue);
  await prices.saveManual(record);
  await queue.acknowledge(record.id, receipt);
  const receiptPath = [...mockFiles.keys()].find(key => key.endsWith('.receipt.json'))!;
  mockFiles.set(receiptPath, '{damaged');
  const open = jest.fn(async () => ({ owner, post: jest.fn() }));
  expect(await prices.loadAll({ requireAll: true })).toEqual([record]);
  expect(await createPriceAppendSync(queue, open)()).toBe('failed');
  expect(open).not.toHaveBeenCalled();
  expect(mockFiles.get(receiptPath)).toBe('{damaged');

  const bodyPath = [...mockFiles.keys()].find(key => key.endsWith('.price.json'))!;
  mockFiles.delete(receiptPath);
  mockFiles.set(bodyPath, JSON.stringify({ ...JSON.parse(mockFiles.get(bodyPath)!), body: '{damaged' }));
  expect(await prices.load(record.id)).toEqual(record);
  expect(await createPriceAppendSync(queue, open)()).toBe('failed');
  expect(open).not.toHaveBeenCalled();
  expect(mockFiles.get(bodyPath)).toContain('{damaged');
});
