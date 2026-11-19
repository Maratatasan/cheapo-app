import { addLocalProduct, findLocalProductByBarcode, replaceLocalProductBarcode } from '@/data/local-products';

const mockFiles = new Map<string, string>();
let mockFailWrite = false;
const mockCatalog = 'file:///test-documents/saved-products.json';
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(parent: string, name: string) { this.uri = `${parent}/${name}`; }
    create() {}
    get exists() { return [...mockFiles.keys()].some(key => key.startsWith(this.uri + '/')); }
    list() { return [...mockFiles.keys()].filter(key => key.startsWith(this.uri + '/')).map(key => new File(this, key.split('/').at(-1)!)); }
  }
  class File {
    uri: string;
    constructor(parent: string | { uri: string }, name: string) { this.uri = `${typeof parent === 'string' ? parent : parent.uri}/${name}`; }
    get name() { return this.uri.split('/').at(-1)!; }
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
  }
  return { Directory, File, Paths: { document: 'file:///test-documents' } };
});

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

test('replaces a barcode without changing product identity or photo references', async () => {
  const saved = await addLocalProduct({ ...addable, photoIds: ['photo-1'] });
  const updated = await replaceLocalProductBarcode(saved.id, product.barcode, '4006381333931');
  expect(updated).toEqual({ ...saved, barcode: '04006381333931' });
  await expect(findLocalProductByBarcode(product.barcode)).resolves.toBeUndefined();
  await expect(findLocalProductByBarcode('4006381333931')).resolves.toEqual(updated);
  let reopened!: typeof findLocalProductByBarcode;
  jest.isolateModules(() => { reopened = jest.requireActual('@/data/local-products').findLocalProductByBarcode; });
  await expect(reopened('4006381333931')).resolves.toEqual(updated);
  await expect(reopened(product.barcode)).resolves.toBeUndefined();
  const independent = await addLocalProduct({ ...addable, id: 'independent' });
  await expect(findLocalProductByBarcode(product.barcode)).resolves.toEqual(independent);
});

test('keeps both mappings on conflict and the original on a failed correction', async () => {
  const saved = await addLocalProduct(addable);
  const other = await addLocalProduct({ ...addable, id: 'other', name: 'Other product', barcode: '4006381333931' });
  await expect(replaceLocalProductBarcode(saved.id, product.barcode, other.barcode!)).rejects.toThrow('Other product');
  await expect(findLocalProductByBarcode(other.barcode!)).resolves.toEqual(other);
  mockFailWrite = true;
  await expect(replaceLocalProductBarcode(saved.id, product.barcode, '96385074')).rejects.toThrow('Disk full');
  await expect(findLocalProductByBarcode(product.barcode)).resolves.toEqual(saved);
  await expect(findLocalProductByBarcode('96385074')).resolves.toBeUndefined();
  mockFailWrite = false;
  await expect(replaceLocalProductBarcode(saved.id, product.barcode, '96385074')).resolves.toMatchObject({ id: saved.id });
  await expect(replaceLocalProductBarcode(saved.id, product.barcode, '4006381333931')).rejects.toThrow('changed');
});
