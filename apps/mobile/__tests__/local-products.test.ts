import { findLocalProductByBarcode } from '@/data/local-products';

let mockCatalog: string | undefined;
jest.mock('expo-file-system', () => ({
  File: class {
    get exists() { return mockCatalog !== undefined; }
    async text() { return mockCatalog; }
  },
  Paths: { document: 'file:///test-documents' },
}));

const product = { id: 'saved-product', name: 'Example product', barcode: '012345678905' };

test('matches the same UPC-A and EAN-13 digits to an exact stable product ID', async () => {
  mockCatalog = JSON.stringify([product]);
  await expect(findLocalProductByBarcode('0012345678905')).resolves.toEqual(product);
  await expect(findLocalProductByBarcode('012345678904')).resolves.toBeUndefined();
});

test('treats an absent catalog as empty and rejects conflicting barcode associations', async () => {
  mockCatalog = undefined;
  await expect(findLocalProductByBarcode(product.barcode)).resolves.toBeUndefined();
  mockCatalog = JSON.stringify([product, { ...product, id: 'duplicate', barcode: '0012345678905' }]);
  await expect(findLocalProductByBarcode(product.barcode)).rejects.toThrow('Invalid or duplicate saved barcode');
});
