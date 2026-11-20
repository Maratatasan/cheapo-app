import { shareAsync, isAvailableAsync } from 'expo-sharing';
import { unzipSync } from 'fflate/browser';

import { emptyReview, loadLocalShoppingBackup, type LocalPhotoDraft, type SavedPriceRecord } from '@/data/local-photo';
import type { ShopRepository } from '@/data/shop-repository';
import { exportShoppingData } from '@/lib/shopping-export';

const mockFiles = new Map<string, Uint8Array>();
const mockWrites = new Map<string, Uint8Array[]>();
const mockRead = jest.fn();
const mockClose = jest.fn();
const mockDelete = jest.fn();
let mockFailWrite = false;

jest.mock('expo-crypto', () => ({ randomUUID: () => 'export-id' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { name: 'Cheapo Field', version: '0.1.8', android: { versionCode: 10 }, extra: { token: 'must-not-export' } } } }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    create() {}
  }
  class File {
    uri: string;
    constructor(parent: string | Directory, name?: string) { this.uri = name ? `${(parent as Directory).uri}/${name}` : String(parent); }
    get name() { return this.uri.split('/').pop()!; }
    get exists() { return mockFiles.has(this.uri); }
    create() { mockFiles.set(this.uri, new Uint8Array()); }
    delete() { mockDelete(this.uri); mockFiles.delete(this.uri); }
    open(mode: 'r' | 'w') {
      const bytes = mockFiles.get(this.uri)!;
      let offset = 0;
      return {
        size: bytes.byteLength,
        readBytes: async (count: number) => {
          expect(mode).toBe('r');
          mockRead(this.uri, count);
          const chunk = bytes.slice(offset, offset + count);
          offset += chunk.byteLength;
          return chunk;
        },
        writeBytes: async (chunk: Uint8Array) => {
          expect(mode).toBe('w');
          if (mockFailWrite) throw Error('disk full');
          const chunks = mockWrites.get(this.uri) ?? [];
          mockWrites.set(this.uri, [...chunks, chunk]);
        },
        close: () => mockClose(this.uri),
      };
    }
  }
  return { Directory, File, FileMode: { ReadOnly: 'r', WriteOnly: 'w' }, Paths: { document: 'file:///documents', cache: 'file:///cache' } };
});
jest.mock('../data/local-photo', () => ({ ...jest.requireActual('../data/local-photo'), loadLocalShoppingBackup: jest.fn() }));
const catalog = {
  legacyProducts: [{ id: 'legacy-rice', name: 'Legacy rice' }],
  originalProducts: [{ id: 'catalog-rice', name: 'Rice', barcode: '00036000291452' }],
  corrections: [{ revision: 1, previous: '00036000291452', product: { id: 'catalog-rice', name: 'Rice', barcode: '04006381333931' } }],
};
const shopRepository = { loadSavedShops: jest.fn<ReturnType<ShopRepository['loadSavedShops']>, []>() };

function setRecords(records: SavedPriceRecord[]) {
  jest.mocked(loadLocalShoppingBackup).mockResolvedValue({ records, catalog });
}

const original = { uri: 'file:///documents/price-photos/rice-original.jpg', width: 1000, height: 600, mimeType: 'image/jpeg' } as const;
const crop = { ...original, uri: 'file:///documents/price-photos/rice-crop.jpg', width: 500, height: 300 };
const complete: LocalPhotoDraft = {
  id: 'rice', capturedAt: '2026-11-12T12:00:00Z', original, selected: crop,
  shop: { id: 'test-shop-id', displayName: 'Test shop' },
  productId: 'catalog-rice',
  review: { ...emptyReview('Test shop'), productName: 'Basmati rice', price: '1.25', unitPrice: '2.50', unit: 'kg', productType: ' Dry rice ', variety: 'Basmati', brand: 'Example brand' },
};
const old: LocalPhotoDraft = { ...complete, id: 'old', selected: original, productId: undefined, shop: undefined, review: emptyReview('Previous shop') };

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockWrites.clear();
  mockFailWrite = false;
  mockFiles.set(original.uri, new Uint8Array(160_000).fill(3));
  mockFiles.set(crop.uri, Uint8Array.of(5, 9, 1));
  jest.mocked(isAvailableAsync).mockResolvedValue(true);
  jest.mocked(shareAsync).mockResolvedValue(undefined);
  setRecords([complete, old]);
  const currentShop = { id: 'test-shop-id', nickname: 'Test shop' };
  shopRepository.loadSavedShops.mockResolvedValue({ shops: [currentShop], currentShop });
});

test('shares an extractable ZIP with reviewed records, older drafts, and portable photo references', async () => {
  await exportShoppingData(new AbortController().signal, shopRepository);
  expect(loadLocalShoppingBackup).toHaveBeenCalledTimes(1);
  expect(shareAsync).toHaveBeenCalledTimes(1);
  const [uri, options] = jest.mocked(shareAsync).mock.calls[0];
  expect(uri).toMatch(/^file:\/\/\/cache\/cheapo-shopping-exports\/cheapo-shopping-.*\.zip$/);
  expect(options?.mimeType).toBe('application/zip');
  const parts = mockWrites.get(uri)!;
  const archive = unzipSync(Buffer.concat(parts));
  expect(Object.keys(archive).sort()).toEqual(['manifest.json', 'photos/1/crop.jpg', 'photos/1/original.jpg', 'photos/2/original.jpg']);
  expect(archive['photos/1/original.jpg']).toEqual(mockFiles.get(original.uri));
  expect(archive['photos/1/crop.jpg']).toEqual(mockFiles.get(crop.uri));
  expect(archive['photos/2/original.jpg']).toEqual(mockFiles.get(original.uri));
  expect(mockRead).toHaveBeenCalledWith(original.uri, 128 * 1024);
  expect(mockClose).toHaveBeenCalledWith(uri);
  const json = new TextDecoder().decode(archive['manifest.json']);
  expect(json).not.toContain('file:');
  expect(json).not.toContain('must-not-export');
  expect(JSON.parse(json)).toMatchObject({
    version: 3,
    exportedAt: expect.any(String),
    source: { appName: 'Cheapo Field', appVersion: '0.1.8', androidVersionCode: 10 },
    currentShopId: 'test-shop-id',
    catalog: {
      legacyProducts: [{ id: 'legacy-rice', name: 'Legacy rice' }],
      originalProducts: [{ id: 'catalog-rice', name: 'Rice', barcode: '00036000291452' }],
      corrections: [{ revision: 1, previous: '00036000291452', product: { id: 'catalog-rice', name: 'Rice', barcode: '04006381333931' } }],
    },
    records: [
      { id: 'rice', productId: 'catalog-rice', capturedAt: complete.capturedAt, status: 'complete', productName: 'Basmati rice', testShop: true,
        shop: { id: 'test-shop-id', displayName: 'Test shop' }, review: complete.review,
        photos: { original: { path: 'photos/1/original.jpg' }, crop: { path: 'photos/1/crop.jpg' }, selectedPath: 'photos/1/crop.jpg' } },
      { id: 'old', status: 'draft', testShop: false, shop: { id: null, displayName: 'Previous shop' },
        photos: { crop: null, selectedPath: 'photos/2/original.jpg' } },
    ],
    savedShops: [{ id: 'test-shop-id', displayName: 'Test shop', testShop: true }],
  });
  expect(mockDelete).not.toHaveBeenCalled();
});

test('exports historical shop identity and photos after a shop leaves the catalogue', async () => {
  shopRepository.loadSavedShops.mockResolvedValue({ shops: [] });
  await exportShoppingData(new AbortController().signal, shopRepository);
  const [[uri]] = jest.mocked(shareAsync).mock.calls;
  const archive = unzipSync(Buffer.concat(mockWrites.get(uri)!));
  const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']));
  expect(manifest.savedShops).toEqual([]);
  expect(manifest.currentShopId).toBeNull();
  expect(manifest.records[0].shop).toEqual(complete.shop);
  expect(archive['photos/1/crop.jpg']).toEqual(mockFiles.get(crop.uri));
});

test('exports manual prices as dated records without creating image entries', async () => {
  const manual = { id: 'manual-price', productId: 'catalog-rice', capturedAt: complete.capturedAt,
    shop: complete.shop!, review: complete.review! };
  setRecords([manual, complete]);
  await exportShoppingData(new AbortController().signal, shopRepository);
  const [[uri]] = jest.mocked(shareAsync).mock.calls;
  const archive = unzipSync(Buffer.concat(mockWrites.get(uri)!));
  expect(Object.keys(archive).sort()).toEqual(['manifest.json', 'photos/2/crop.jpg', 'photos/2/original.jpg']);
  const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']));
  expect(manifest.version).toBe(3);
  expect(manifest.records[0]).toMatchObject({
    id: 'manual-price', productId: 'catalog-rice', status: 'complete', capturedAt: manual.capturedAt, photos: null,
  });
});

test('does not share an incomplete archive or read outside the saved photo directory', async () => {
  const outside = { ...original, uri: 'file:///documents/private/other.jpg' };
  mockFiles.set(outside.uri, Uint8Array.of(1));
  setRecords([{ ...complete, original: outside }]);
  await expect(exportShoppingData(new AbortController().signal, shopRepository)).rejects.toThrow('saved photo is missing or unreadable');
  expect(mockRead).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
});

test('reports a missing linked product before creating an archive', async () => {
  setRecords([{ ...complete, productId: 'missing-product' }]);
  await expect(exportShoppingData(new AbortController().signal, shopRepository)).rejects.toThrow('refers to a missing product');
  expect(mockWrites.size).toBe(0);
  expect(shareAsync).not.toHaveBeenCalled();
});

test('deletes only the failed temporary archive when writing fails', async () => {
  mockFailWrite = true;
  await expect(exportShoppingData(new AbortController().signal, shopRepository)).rejects.toThrow('Could not export');
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/cache\/cheapo-shopping-exports\//));
  expect([...mockFiles.keys()]).toEqual([original.uri, crop.uri]);
});

test('never opens sharing after cancellation', async () => {
  const controller = new AbortController();
  mockRead.mockImplementationOnce(() => controller.abort());
  await expect(exportShoppingData(controller.signal, shopRepository)).rejects.toThrow('Export cancelled');
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledTimes(1);
});

test('writes an enrolled recovery ZIP with both source records, full photos and exact queue bytes', async () => {
  const enrolled = {
    ...complete, productId: 'remote-product', review: { ...complete.review!, price: '02.39', packSize: ' 500 g ' },
  };
  const owner = {
    origin: 'https://shopping.example',
    householdId: '93b93988-a027-483e-8c4d-ed58a163fbfa',
    shopperId: 'd002d3a7-2744-4414-8336-afc644ec6878',
  };
  const intent = ' { "operationId": "fix-rice" }\n';
  const pending = '{"operationId":';
  const price = ' { "body": "{\\"price\\":\\"02.39\\"}" }\n';
  const raw = [
    { path: 'recovery/prices/rice.price.json', bytes: new TextEncoder().encode(price) },
    { path: 'recovery/mutations/fix-rice.request.json', bytes: new TextEncoder().encode(intent) },
    { path: 'recovery/mutations/fix-rice.resolution.json.stage.pending', bytes: new TextEncoder().encode(pending) },
    { path: 'recovery/mutations/partial.intent.json.stage.pending', bytes: new Uint8Array() },
  ];
  const assertCurrentOwner = jest.fn(async () => {});
  await exportShoppingData(new AbortController().signal, shopRepository, async () => ({
    owner, records: [enrolled], files: raw, priceRecovery: [], mutationRecovery: [], assertCurrentOwner,
  }));
  const [[uri]] = jest.mocked(shareAsync).mock.calls;
  const archive = unzipSync(Buffer.concat(mockWrites.get(uri)!));
  const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json']));
  expect(manifest.version).toBe(4);
  expect(manifest.records[0].id).toBe(enrolled.id);
  expect(manifest.records[0].productId).toBe(complete.productId);
  expect(manifest.recovery).toMatchObject({
    owner, queueFiles: raw.map(entry => entry.path),
    interruptedFiles: raw.slice(2).map(entry => entry.path),
    records: [{ id: enrolled.id, productId: 'remote-product',
      review: { price: '02.39', packSize: ' 500 g ' },
      photos: { original: { path: 'enrolled-photos/1/original.jpg' }, selectedPath: 'enrolled-photos/1/crop.jpg' },
    }],
  });
  expect(archive['enrolled-photos/1/original.jpg']).toEqual(mockFiles.get(original.uri));
  expect(archive['enrolled-photos/1/crop.jpg']).toEqual(mockFiles.get(crop.uri));
  for (const { path, bytes } of raw) expect(archive[path]).toEqual(bytes);
  expect(assertCurrentOwner).toHaveBeenCalledTimes(1);
});

test('retains source files and withholds an enrolled archive when the owner changes before sharing', async () => {
  const assertCurrentOwner = jest.fn(async () => { throw Error('Owner changed.'); });
  await expect(exportShoppingData(new AbortController().signal, shopRepository, async () => ({
    owner: { origin: 'https://shopping.example', householdId: 'fixture-household', shopperId: 'fixture-shopper' },
    records: [], files: [], priceRecovery: [], mutationRecovery: [], assertCurrentOwner,
  }))).rejects.toThrow('Could not export');
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect([...mockFiles.keys()]).toEqual([original.uri, crop.uri]);
});
