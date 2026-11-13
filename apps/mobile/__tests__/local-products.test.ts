import { addLocalProduct, findLocalProductByBarcode } from '@/data/local-products';

const mockFiles = new Map<string, string>();
let mockFailWrite = false;
const mockCatalog = 'file:///test-documents/saved-products.json';
jest.mock('expo-file-system', () => ({
  Directory: class {
    uri: string;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    create() {}
  },
  File: class {
    uri: string;
    constructor(parent: string | { uri: string }, name: string) { this.uri = `${typeof parent === 'string' ? parent : parent.uri}/${name}`; }
    get exists() { return mockFiles.has(this.uri); }
    async text() { return mockFiles.get(this.uri); }
    async write(value: string) { if (mockFailWrite) throw Error('Disk full'); mockFiles.set(this.uri, value); }
    async move(to: { uri: string }) {
      if (mockFiles.has(to.uri)) throw Error('Already exists');
      mockFiles.set(to.uri, mockFiles.get(this.uri)!);
      this.delete();
      this.uri = to.uri;
    }
    delete() { mockFiles.delete(this.uri); }
  },
  Paths: { document: 'file:///test-documents' },
}));

const product = { id: 'saved-product', name: 'Example product', barcode: '012345678905' };
const addable = { ...product, productType: 'Dry rice' };

beforeEach(() => { mockFiles.clear(); mockFailWrite = false; });

test('matches the same UPC-A and EAN-13 digits to an exact stable product ID', async () => {
  mockFiles.set(mockCatalog, JSON.stringify([product]));
  await expect(findLocalProductByBarcode('0012345678905')).resolves.toEqual(product);
  await expect(findLocalProductByBarcode('012345678904')).resolves.toBeUndefined();
});

test('treats an absent catalog as empty and rejects conflicting barcode associations', async () => {
  await expect(findLocalProductByBarcode(product.barcode)).resolves.toBeUndefined();
  mockFiles.set(mockCatalog, JSON.stringify([product, { ...product, id: 'duplicate', barcode: '0012345678905' }]));
  await expect(findLocalProductByBarcode(product.barcode)).rejects.toThrow('Invalid or duplicate saved barcode');
});

test('adds a stable product and resolves an equivalent rescan and idempotent retry', async () => {
  const saved = await addLocalProduct(addable);
  expect(saved).toEqual({ ...addable, barcode: '00012345678905' });
  await expect(findLocalProductByBarcode('0012345678905')).resolves.toEqual(saved);
  await expect(addLocalProduct({ ...addable, name: 'Changed' })).resolves.toEqual(saved);
  await expect(addLocalProduct({ ...addable, id: 'different-id' })).rejects.toThrow('already has a saved product');
});

test('preserves the winner of concurrent barcode claims and supports retry after a failed write', async () => {
  mockFailWrite = true;
  await expect(addLocalProduct(addable)).rejects.toThrow('Disk full');
  await expect(findLocalProductByBarcode(product.barcode)).resolves.toBeUndefined();
  mockFailWrite = false;
  const results = await Promise.allSettled([addLocalProduct(addable), addLocalProduct({ ...addable, id: 'other' })]);
  const successes = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  expect(successes).toHaveLength(1);
  await expect(findLocalProductByBarcode(product.barcode)).resolves.toEqual(successes[0]);
});
