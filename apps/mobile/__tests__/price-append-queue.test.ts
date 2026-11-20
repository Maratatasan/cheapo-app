import { Directory, File, Paths } from 'expo-file-system';

import { emptyReview, type ManualPriceRecord } from '../data/local-photo';
import { openPriceAppendQueue } from '../data/price-append-queue';
import { createPriceAppendSync } from '../data/price-append-sync';
import { createPriceEvidenceSync } from '../data/price-evidence-sync';
import { createPriceRecords } from '../data/price-records';
import { readPendingPrices } from '../data/pending-price-sync';
import type { PricePhotoIntent } from '../data/cheapo-price-photo-transfer';
import { openCheapoShopping } from '../data/shopping-sync-runtime';
import { priceChangeIsNewerThan } from '../data/shopping-pending-price-changes';

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
    async copy(target: File) { mockFiles.set(target.uri, mockFiles.get(this.uri)!); }
    async write(value: string) { mockFiles.set(this.uri, value); }
    async text() { return mockFiles.get(this.uri); }
    async bytes() { return new TextEncoder().encode(mockFiles.get(this.uri) ?? ''); }
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

function fixtureSession(post: (serialized: string, signal?: AbortSignal) => Promise<Response>, sessionOwner = owner) {
  return {
    owner: sessionOwner,
    assertCurrent() {},
    request(path: string, init: RequestInit) {
      expect(path).toBe('/v1/me/price-observations');
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
      if (typeof init.body !== 'string') throw Error('Missing serialized test request.');
      return post(init.body, init.signal ?? undefined);
    },
  };
}

async function photoEvidence() {
  const directory = new Directory(Paths.document, 'price-photos');
  const originalFile = new File(directory, `${record.id}-original.jpg`);
  const selectedFile = new File(directory, `${record.id}-selected-123.jpg`);
  await originalFile.write('synthetic original');
  await selectedFile.write('synthetic crop');
  const original = { uri: originalFile.uri, width: 120, height: 100, size: originalFile.size, mimeType: 'image/jpeg' as const };
  const selected = { uri: selectedFile.uri, width: 80, height: 60, size: selectedFile.size, mimeType: 'image/jpeg' as const };
  const photo = { ...record, original, selected };
  const common = { sourceId: record.id, observationId: receipt.id };
  const intents: PricePhotoIntent[] = [
    { ...common, role: 'original', uri: original.uri, width: original.width, height: original.height, sha256: 'a'.repeat(64), byteCount: original.size },
    { ...common, role: 'crop', uri: selected.uri, width: selected.width, height: selected.height, sha256: 'b'.repeat(64), byteCount: selected.size },
  ];
  return { photo, intents };
}

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
  expect(await readPendingPrices(original)).toEqual([{ id: `price:${record.id}`, sourceId: record.id, title: 'Test rice', state: 'waiting' }]);
  const post = jest.fn(async () => Response.json(receipt));
  await expect(createPriceAppendSync(original, async () => fixtureSession(post, other))()).resolves.toBe('blocked');
  await expect(createPriceAppendSync(original, async () => fixtureSession(post, { ...owner, origin: 'https://staging.example' }))()).resolves.toBe('blocked');
  expect(post).not.toHaveBeenCalled();
  expect((await (await openPriceAppendQueue(other)).read()).entries).toEqual([]);
  await expect(createPriceAppendSync(original, async () => fixtureSession(async () => new Response(null, { status: 403 })))()).resolves.toBe('blocked');
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
  await expect(createPriceAppendSync(original, async () => fixtureSession(append))()).resolves.toBe('failed');
  const restarted = await openPriceAppendQueue({ ...owner });
  expect((await restarted.read()).entries).toEqual([{ record, body: previousBody }]);
  expect((await readPendingPrices(restarted)).map(({ state }) => state)).toEqual(['failed']);
  await expect(createPriceAppendSync(restarted, async () => fixtureSession(append, { ...owner }))()).resolves.toBe('complete');
  expect(server.size).toBe(1);
  expect(append.mock.calls.map(([sent]) => sent)).toEqual([previousBody, previousBody]);
  expect((await (await openPriceAppendQueue(owner)).read()).entries).toEqual([{ record, body: previousBody, receipt }]);
  expect(await readPendingPrices(restarted)).toEqual([]);
  const reopen = jest.fn(async () => fixtureSession(post));
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
  const post = jest.fn(async () => Response.json(receipt));
  const session = fixtureSession(post);
  mockFailedPublication = /\.receipt\.json$/;
  await expect(createPriceAppendSync(queue, async () => session)()).resolves.toBe('failed');
  const restarted = await openPriceAppendQueue(owner);
  expect(await restarted.read()).toEqual({ entries: [{ record, body }], recovery: [{ sourceId: record.id, reason: 'unfinished' }] });
  mockFailedPublication = /$a/;
  await expect(createPriceAppendSync(restarted, async () => session)()).resolves.toBe('complete');
  expect(await restarted.read()).toEqual({ entries: [{ record, body, receipt }], recovery: [] });
  expect(post.mock.calls).toEqual([[body, expect.any(AbortSignal)], [body, expect.any(AbortSignal)]]);
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
    const sync = createPriceAppendSync(queue, async () => fixtureSession(post));
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
  const sync = createPriceAppendSync(queue, async () => fixtureSession(post));
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
  const open = jest.fn(async () => fixtureSession(jest.fn()));
  expect(await prices.loadAll({ requireAll: true })).toEqual([record]);
  expect(await readPendingPrices(queue)).toEqual([{ id: `recovery:${record.id}`, sourceId: record.id, title: 'Test rice', state: 'recovery' }]);
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

it('persists only acknowledged prices’ upload plans and retries only the unverified evidence role after restart', async () => {
  const { photo, intents } = await photoEvidence();
  const queue = await openPriceAppendQueue(owner);
  await queue.save(photo);
  const open = jest.fn(async () => fixtureSession(jest.fn()));
  const describe = jest.fn(async () => intents);
  const transfer = jest.fn<Promise<'available' | 'retry'>, [PricePhotoIntent]>()
    .mockImplementation(async intent => intent.role === 'original' ? 'available' : 'retry');
  const sync = createPriceEvidenceSync(queue, open, describe, transfer);
  expect(await sync()).toBe('complete');
  expect(describe).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  await queue.acknowledge(record.id, receipt);
  expect((await readPendingPrices(queue)).map(({ state }) => state)).toEqual(['photo-pending']);

  expect(await sync()).toBe('failed');
  expect(describe).toHaveBeenCalledTimes(1);
  expect(transfer.mock.calls.map(([intent]) => intent)).toEqual(intents);
  const reopened = await openPriceAppendQueue({ ...owner });
  expect(await reopened.evidence.load({ record: photo, receipt })).toEqual([intents[1]]);
  expect((await readPendingPrices(reopened)).map(({ state }) => state)).toEqual(['photo-failed']);
  const retry = jest.fn(async () => 'available' as const);
  expect(await createPriceEvidenceSync(reopened, open, describe, retry)()).toBe('complete');
  expect(describe).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledWith(intents[1], expect.any(Object), undefined);
  expect(await reopened.evidence.load({ record: photo, receipt })).toEqual([]);
  expect(await readPendingPrices(reopened)).toEqual([]);
  expect(await (await openPriceAppendQueue(owner)).evidence.load({ record: photo, receipt })).toEqual([]);
  expect(mockFiles.get(photo.original.uri)).toBe('synthetic original');
  expect(mockFiles.get(photo.selected.uri)).toBe('synthetic crop');
});

it('keeps the evidence plan on another enrollment and retries an interrupted role acknowledgement', async () => {
  const { photo, intents } = await photoEvidence();
  const queue = await openPriceAppendQueue(owner);
  await queue.save(photo);
  await queue.acknowledge(record.id, receipt);
  const describe = jest.fn(async () => intents);
  const transfer = jest.fn(async () => 'available' as const);
  const wrongSession = async () => fixtureSession(jest.fn(), other);
  expect(await createPriceEvidenceSync(queue, wrongSession, describe, transfer)()).toBe('blocked');
  expect(transfer).not.toHaveBeenCalled();
  expect(await queue.evidence.load({ record: photo, receipt })).toEqual(intents);
  expect(await (await openPriceAppendQueue(other)).evidence.load({ record: photo, receipt })).toBeNull();

  const open = async () => fixtureSession(jest.fn());
  mockFailedPublication = /\.crop\.evidence-available\.json$/;
  expect(await createPriceEvidenceSync(queue, open, describe, transfer)()).toBe('failed');
  expect(await queue.evidence.load({ record: photo, receipt })).toEqual([intents[1]]);
  expect(mockFiles.get(photo.selected.uri)).toBe('synthetic crop');
  mockFailedPublication = /$a/;
  expect(await createPriceEvidenceSync(await openPriceAppendQueue(owner), open, describe, transfer)()).toBe('complete');
  expect(describe).toHaveBeenCalledTimes(1);
  expect(transfer.mock.calls).toEqual([
    [intents[0], expect.any(Object), undefined], [intents[1], expect.any(Object), undefined],
    [intents[1], expect.any(Object), undefined],
  ]);
});

it('holds a complete photo with no stable shop and preserves it through interrupted branch confirmation', async () => {
  const { photo } = await photoEvidence();
  const openShoppingWriteSession = jest.fn();
  const access = { lastVerifiedOwner: async () => owner, openShoppingWriteSession };
  const runtime = (await openCheapoShopping(access))!;
  const unconfirmed = { ...photo, shop: undefined, review: { ...photo.review, shop: 'Typed shop name' } };
  const result = await runtime.priceRecords.saveNewPhoto(unconfirmed);
  expect(result.pending).toBe('needs-shop');
  expect(mockFiles.get(result.record.original.uri)).toBe('synthetic original');
  expect(mockFiles.get(result.record.selected.uri)).toBe('synthetic crop');
  expect(await runtime.priceRecords.loadAll({ requireAll: true })).toEqual([result.record]);
  const committedPath = [...mockFiles.keys()].find(key => key.endsWith('.needs-shop.json'))!;
  const interrupted = '{"record":';
  mockFiles.set(`${committedPath}.fixture.pending`, interrupted);
  const snapshot = await runtime.priceQueue.backup();
  expect(snapshot.entries).toEqual([{ record: result.record, needsShop: true }]);
  expect(snapshot.recovery).toEqual([{ sourceId: record.id, reason: 'unfinished' }]);
  const bytes = Object.fromEntries(snapshot.files.map(file => [file.name, new TextDecoder().decode(file.bytes)]));
  expect(JSON.parse(bytes[`${record.id}.needs-shop.json`]).record).toEqual(result.record);
  expect(bytes[`${record.id}.needs-shop.json.fixture.pending`]).toBe(interrupted);
  mockFiles.delete(`${committedPath}.fixture.pending`);
  expect(await runtime.retry()).toMatchObject({ state: 'pending', items: [{ sourceId: record.id, state: 'needs-shop' }] });
  expect(openShoppingWriteSession).not.toHaveBeenCalled();

  const reopened = (await openCheapoShopping(access))!;
  mockFailedPublication = /\.price\.json$/;
  await expect(reopened.priceQueue.confirmShop(record.id, shop)).rejects.toThrow('Publication interrupted');
  expect(await reopened.priceRecords.load(record.id)).toEqual(result.record);
  expect(await reopened.readPending()).toMatchObject([{ sourceId: record.id, state: 'needs-shop' }]);
  mockFailedPublication = /$a/;
  const confirmed = await reopened.priceQueue.confirmShop(record.id, shop);
  expect(confirmed).toMatchObject({ id: record.id, shop, review: { shop: shop.displayName, price: record.review.price },
    original: result.record.original, selected: result.record.selected });
  expect(await reopened.priceQueue.confirmShop(record.id, shop)).toEqual(confirmed);
  expect(await reopened.priceRecords.loadAll()).toEqual([confirmed]);
  expect(await reopened.readPending()).toMatchObject([{ sourceId: record.id, state: 'waiting' }]);
  const entry = (await reopened.priceQueue.read()).entries[0];
  expect(JSON.parse(entry.body ?? '{}')).toMatchObject({ sourceId: record.id, shopId: shop.id, shopDisplayName: shop.displayName });
  expect([...mockFiles.keys()].some(key => key.endsWith('.needs-shop.json'))).toBe(true);
});

const queuedShop = { id: shop.id, name: shop.displayName };
const queuedProduct = { id: record.productId, name: record.review.productName };
const operationTime = '2026-11-20T12:10:00.000Z';

it('holds a price behind its shop and product, then applies its offline edit using the append receipt', async () => {
  let shopOnline = false;
  const request = jest.fn<Promise<Response>, [string, RequestInit]>(async (path, init) => {
    const sent = JSON.parse(String(init.body));
    if (path === `/v1/me/saved-shops/${shop.id}`) {
      expect(sent.operationId).toBe('create-shop');
      return shopOnline ? Response.json({ shop: queuedShop, version: '1:fa91641f-d265-4a3b-9695-4ff553ab5138' }, { status: 201 })
        : new Response(null, { status: 503 });
    }
    if (path === `/v1/products/${record.productId}`) {
      expect(sent.operationId).toBe('create-product');
      return Response.json({ product: queuedProduct, version: 1 }, { status: 201 });
    }
    if (path === '/v1/me/price-observations') return Response.json(receipt, { status: 201 });
    expect(path).toBe(`/v1/me/price-observations/${receipt.id}`);
    expect(sent).toMatchObject({ operationId: 'edit-price', expectedVersion: 1, review: { price: '1.85' } });
    return Response.json({ observation: { id: receipt.id, version: 2 } });
  });
  const openShoppingWriteSession = jest.fn(async () => ({ owner, assertCurrent() {}, request }));
  const access = { lastVerifiedOwner: async () => owner, openShoppingWriteSession };
  const selected = (await openCheapoShopping(access))!;
  await selected.priceRecords.saveManual(record);
  await selected.mutationQueue.enqueue({ operationId: 'create-shop', title: shop.displayName, createdAt: operationTime,
    action: { kind: 'save-shop', shop: queuedShop } });
  await selected.mutationQueue.enqueue({ operationId: 'create-product', title: record.review.productName, createdAt: operationTime,
    action: { kind: 'create-product', product: queuedProduct } });
  await selected.mutationQueue.enqueue({ operationId: 'edit-price', title: 'Edit rice price', createdAt: operationTime,
    action: { kind: 'price', priceKey: record.id, base: { kind: 'append', sourceId: record.id },
      change: { action: 'correct', review: { productName: record.review.productName, price: '1.85', currency: 'GBP' } } } });

  const first = await selected.retry();
  expect(first.state).toBe('pending');
  expect(first.items.map(({ state }) => state)).toEqual(['waiting', 'failed', 'waiting']);
  expect(request.mock.calls.map(([path]) => path)).toEqual([`/v1/products/${record.productId}`, `/v1/me/saved-shops/${shop.id}`]);
  expect(openShoppingWriteSession).toHaveBeenCalledTimes(1);
  expect(await selected.loadPriceChanges()).toMatchObject([{ sourceId: record.id, change: { review: { price: '1.85' } } }]);

  shopOnline = true;
  const reopened = (await openCheapoShopping(access))!;
  expect(await reopened.retry()).toEqual({ state: 'complete', items: [] });
  expect(request.mock.calls.slice(2).map(([path]) => path)).toEqual([
    `/v1/me/saved-shops/${shop.id}`, '/v1/me/price-observations', `/v1/me/price-observations/${receipt.id}`,
  ]);
  expect(openShoppingWriteSession).toHaveBeenCalledTimes(2);
  const offline = (await openCheapoShopping({ ...access, openShoppingWriteSession: async () => { throw Error('Offline'); } }))!;
  const [savedEdit] = await offline.loadPriceChanges();
  expect(savedEdit).toMatchObject({ state: 'acknowledged', resourceId: receipt.id, acceptedVersion: 2, change: { review: { price: '1.85' } } });
  expect(priceChangeIsNewerThan(savedEdit, undefined)).toBe(true);
  expect(priceChangeIsNewerThan(savedEdit, 1)).toBe(true);
  expect(priceChangeIsNewerThan(savedEdit, 2)).toBe(false);
  expect(priceChangeIsNewerThan(savedEdit, 3)).toBe(false);
  await reopened.retry();
  expect(openShoppingWriteSession).toHaveBeenCalledTimes(2);
});

it('coalesces full passes and checks that a queued read still belongs to the selected shopper', async () => {
  let remembered = owner;
  let release!: (response: Response) => void;
  let began!: () => void;
  const sending = new Promise<void>(resolve => { began = resolve; });
  const request = jest.fn<Promise<Response>, [string, RequestInit]>()
    .mockImplementationOnce(() => new Promise(resolve => { release = resolve; began(); }))
    .mockImplementation(async () => Response.json({ shop: queuedShop, version: '1:fa91641f-d265-4a3b-9695-4ff553ab5138' }));
  const openShoppingWriteSession = jest.fn(async () => ({ owner, assertCurrent() {}, request }));
  const shopping = (await openCheapoShopping({ lastVerifiedOwner: async () => remembered, openShoppingWriteSession }))!;
  await shopping.priceRecords.saveManual(record);
  const initial = shopping.retry();
  await sending;
  await shopping.mutationQueue.enqueue({ operationId: 'next-shop', title: shop.displayName, createdAt: operationTime,
    action: { kind: 'save-shop', shop: queuedShop } });
  const again = shopping.retry();
  expect(again).toBe(initial);
  release(Response.json(receipt, { status: 201 }));
  expect(await again).toEqual({ state: 'complete', items: [] });
  expect(request.mock.calls.map(([path]) => path)).toEqual(['/v1/me/price-observations', `/v1/me/saved-shops/${shop.id}`]);
  remembered = other;
  await expect(shopping.readPending()).rejects.toThrow('Cheapo access changed');
  await expect(shopping.loadPriceChanges()).rejects.toThrow('Cheapo access changed');
});

it('keeps pending read overlays in dependency order even for same-time edits and separate server identities', async () => {
  const runtime = (await openCheapoShopping({ lastVerifiedOwner: async () => owner, openShoppingWriteSession: jest.fn() }))!;
  await runtime.priceRecords.saveManual(record);
  await runtime.priceQueue.acknowledge(record.id, receipt);
  await runtime.mutationQueue.enqueue({ operationId: 'z-first', title: 'Edit rice', createdAt: operationTime,
    action: { kind: 'price', priceKey: record.id, base: { kind: 'append', sourceId: record.id },
      change: { action: 'correct', review: { productName: 'Rice', price: '1.80', currency: 'GBP' } } } });
  await runtime.mutationQueue.enqueue({ operationId: 'a-later', title: 'Flag rice', createdAt: operationTime,
    action: { kind: 'price', priceKey: record.id, base: { kind: 'operation', operationId: 'z-first' },
      change: { action: 'record_in_error', reason: 'Wrong shelf' } } });
  const otherId = 'a9208dad-5a8e-4966-812c-879a550706c2';
  await runtime.mutationQueue.enqueue({ operationId: 'unrelated', title: 'Another rice price', createdAt: operationTime,
    action: { kind: 'price', priceKey: record.id, base: { kind: 'version', id: otherId, version: 3 },
      change: { action: 'record_in_error', reason: 'Duplicate' } } });
  expect(await runtime.loadPriceChanges()).toMatchObject([
    { operationId: 'z-first', sourceId: record.id, resourceId: receipt.id },
    { operationId: 'a-later', sourceId: record.id, resourceId: receipt.id },
    { operationId: 'unrelated', sourceId: undefined, resourceId: otherId },
  ]);
});

it('holds mismatched conflict replies and preserves the full valid version for the requested record', async () => {
  const unrelatedPrice = 'a9208dad-5a8e-4966-812c-879a550706c2';
  const version = '2:fa91641f-d265-4a3b-9695-4ff553ab5138';
  let validReplies = false;
  const request = async (path: string) => {
    let currentVersion: string | number = 2;
    let current: object;
    if (path.includes('price-observations')) {
      current = { id: validReplies ? receipt.id : unrelatedPrice, version: 2, review: { price: '2.75', packSize: '600 g' } };
    } else if (path.includes('saved-shops')) {
      currentVersion = version;
      current = { id: validReplies ? shop.id : 'other-shop', name: 'New market', nickname: 'Our branch' };
    } else if (path.includes('comparison-preferences')) {
      current = { basis: validReplies ? 'kg' : 'case' };
    } else {
      current = { id: validReplies ? record.productId : 'other-product', name: 'Short grain rice', variety: 'Short grain' };
    }
    return Response.json({ error: 'version_conflict', currentVersion, current }, { status: 409 });
  };
  const runtime = (await openCheapoShopping({ lastVerifiedOwner: async () => owner,
    openShoppingWriteSession: async () => ({ owner, request, assertCurrent() {} }) }))!;
  await runtime.mutationQueue.enqueue({ operationId: 'price-edit', title: 'Price', createdAt: operationTime,
    action: { kind: 'price', priceKey: receipt.id, base: { kind: 'version', id: receipt.id, version: 1 },
      change: { action: 'record_in_error', reason: 'Wrong shelf' } } });
  await runtime.mutationQueue.enqueue({ operationId: 'shop-edit', title: 'Shop', createdAt: operationTime,
    action: { kind: 'edit-shop', shopId: shop.id, details: { nickname: 'Local' },
      base: { kind: 'version', version: '1:fa91641f-d265-4a3b-9695-4ff553ab5138' } } });
  await runtime.mutationQueue.enqueue({ operationId: 'product-edit', title: 'Product', createdAt: operationTime,
    action: { kind: 'edit-product', product: queuedProduct, base: { kind: 'version', version: 1 } } });
  await runtime.mutationQueue.enqueue({ operationId: 'preference-edit', title: 'Preference', createdAt: operationTime,
    action: { kind: 'preference', groupId: 'rice', basis: 'item', base: { kind: 'version', version: 1 } } });
  expect((await runtime.retry()).items.map(({ state }) => state)).toEqual(['failed', 'failed', 'failed', 'failed']);
  expect((await runtime.mutationQueue.read()).entries.every(({ outcome }) => !outcome)).toBe(true);
  validReplies = true;
  expect((await runtime.retry()).items.map(({ state }) => state)).toEqual(['conflict', 'conflict', 'conflict', 'conflict']);
  const { entries } = await runtime.mutationQueue.read();
  expect(entries.find(({ intent }) => intent.operationId === 'price-edit')?.outcome).toEqual({ kind: 'conflict', currentVersion: 2,
    current: { id: receipt.id, version: 2, review: { price: '2.75', packSize: '600 g' } } });
});

it('backs up only the enrolled price and evidence phases and retains interrupted bytes', async () => {
  const queue = await openPriceAppendQueue(owner);
  await queue.save(record);
  await queue.acknowledge(record.id, receipt);
  await queue.markFailed(record.id, 'photo');
  const activeFile = [...mockFiles.keys()].find(key => key.endsWith('.price.json'))!;
  const scope = activeFile.substring(0, activeFile.lastIndexOf('/') + 1);
  const evidence = ' { "role": "original", "fixture": "Café" }\n';
  const unfinished = '{"photo":';
  mockFiles.set(scope + `${record.id}.evidence.json`, evidence);
  mockFiles.set(scope + `${record.id}.original.evidence-available.json`, '{"role":"original"}');
  mockFiles.set(scope + `${record.id}.crop.evidence-available.json.staging.pending`, unfinished);
  mockFiles.set(scope + 'other-private-file.json', 'ignored');
  await (await openPriceAppendQueue(other)).save({ ...record, id: 'another-owner-local-price' });

  const backup = await queue.backup();
  expect(backup.entries).toMatchObject([{ record, receipt }]);
  const contents = Object.fromEntries(backup.files.map(file => [file.name, new TextDecoder().decode(file.bytes)]));
  expect(Object.keys(contents).sort()).toEqual([
    `${record.id}.crop.evidence-available.json.staging.pending`,
    `${record.id}.evidence.json`, `${record.id}.original.evidence-available.json`,
    `${record.id}.photo.sync-failed`, `${record.id}.price.json`, `${record.id}.receipt.json`,
  ]);
  expect(contents[`${record.id}.evidence.json`]).toBe(evidence);
  expect(contents[`${record.id}.crop.evidence-available.json.staging.pending`]).toBe(unfinished);
  expect(JSON.parse(contents[`${record.id}.price.json`]).body).toBe(body);
});
