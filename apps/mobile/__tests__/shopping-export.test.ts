import { shareAsync, isAvailableAsync } from 'expo-sharing';
import { unzipSync } from 'fflate/browser';

import { emptyReview, loadLocalPhotos, type LocalPhotoDraft } from '@/data/local-photo';
import { loadSavedShops } from '@/data/local-shops';
import { exportShoppingData } from '@/lib/shopping-export';

const mockFiles = new Map<string, Uint8Array>();
const mockWrites = new Map<string, Uint8Array[]>();
const mockRead = jest.fn();
const mockClose = jest.fn();
const mockDelete = jest.fn();
let mockFailWrite = false;

jest.mock('expo-crypto', () => ({ randomUUID: () => 'export-id' }));
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
jest.mock('../data/local-photo', () => ({ ...jest.requireActual('../data/local-photo'), loadLocalPhotos: jest.fn() }));
jest.mock('../data/local-shops', () => ({ loadSavedShops: jest.fn() }));

const original = { uri: 'file:///documents/price-photos/rice-original.jpg', width: 1000, height: 600, mimeType: 'image/jpeg' } as const;
const crop = { ...original, uri: 'file:///documents/price-photos/rice-crop.jpg', width: 500, height: 300 };
const complete: LocalPhotoDraft = {
  id: 'rice', capturedAt: '2026-11-12T12:00:00Z', original, selected: crop,
  shop: { id: 'test-shop-id', displayName: 'Test shop' },
  review: { ...emptyReview('Test shop'), productName: 'Basmati rice', price: '1.25', unitPrice: '2.50', unit: 'kg', productType: 'Dry rice', variety: 'Basmati', brand: 'Example brand' },
};
const old: LocalPhotoDraft = { ...complete, id: 'old', selected: original, shop: undefined, review: emptyReview('Previous shop') };

beforeEach(() => {
  jest.clearAllMocks();
  mockFiles.clear();
  mockWrites.clear();
  mockFailWrite = false;
  mockFiles.set(original.uri, new Uint8Array(160_000).fill(3));
  mockFiles.set(crop.uri, Uint8Array.of(5, 9, 1));
  jest.mocked(isAvailableAsync).mockResolvedValue(true);
  jest.mocked(shareAsync).mockResolvedValue(undefined);
  jest.mocked(loadLocalPhotos).mockResolvedValue([complete, old]);
  jest.mocked(loadSavedShops).mockResolvedValue({ shops: [{ id: 'test-shop-id', nickname: 'Test shop' }] });
});

test('shares an extractable ZIP with reviewed records, older drafts, and portable photo references', async () => {
  await exportShoppingData(new AbortController().signal);
  expect(loadLocalPhotos).toHaveBeenCalledWith({ requireAll: true });
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
  expect(JSON.parse(json)).toMatchObject({
    version: 1,
    exportedAt: expect.any(String),
    records: [
      { id: 'rice', capturedAt: complete.capturedAt, status: 'complete', productName: 'Basmati rice', testShop: true,
        shop: { id: 'test-shop-id', displayName: 'Test shop' }, review: complete.review,
        photos: { original: { path: 'photos/1/original.jpg' }, crop: { path: 'photos/1/crop.jpg' }, selectedPath: 'photos/1/crop.jpg' } },
      { id: 'old', status: 'draft', testShop: false, shop: { id: null, displayName: 'Previous shop' },
        photos: { crop: null, selectedPath: 'photos/2/original.jpg' } },
    ],
    savedShops: [{ id: 'test-shop-id', displayName: 'Test shop', testShop: true }],
  });
  expect(mockDelete).not.toHaveBeenCalled();
});

test('does not share an incomplete archive or read outside the saved photo directory', async () => {
  const outside = { ...original, uri: 'file:///documents/private/other.jpg' };
  mockFiles.set(outside.uri, Uint8Array.of(1));
  jest.mocked(loadLocalPhotos).mockResolvedValue([{ ...complete, original: outside }]);
  await expect(exportShoppingData(new AbortController().signal)).rejects.toThrow('saved photo is missing or unreadable');
  expect(mockRead).not.toHaveBeenCalled();
  expect(shareAsync).not.toHaveBeenCalled();
});

test('deletes only the failed temporary archive when writing fails', async () => {
  mockFailWrite = true;
  await expect(exportShoppingData(new AbortController().signal)).rejects.toThrow('Could not export');
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockDelete).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/cache\/cheapo-shopping-exports\//));
  expect([...mockFiles.keys()]).toEqual([original.uri, crop.uri]);
});

test('never opens sharing after cancellation', async () => {
  const controller = new AbortController();
  mockRead.mockImplementationOnce(() => controller.abort());
  await expect(exportShoppingData(controller.signal)).rejects.toThrow('Export cancelled');
  expect(shareAsync).not.toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledTimes(1);
});
