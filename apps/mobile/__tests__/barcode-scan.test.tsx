import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BarcodeScan } from '@/component/barcode-scan';
import { addLocalProduct, findLocalProductByBarcode } from '@/data/local-products';
import { emptyReview } from '@/data/photo-review';
import { loadLocalPhotos, type LocalPhotoDraft } from '@/data/local-photo';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned: () => void }) => {
    const { View } = require('react-native');
    return <View testID="barcode-preview" onBarcodeScanned={onBarcodeScanned} />;
  },
}));
jest.mock('@/data/local-products', () => ({ addLocalProduct: jest.fn(), findLocalProductByBarcode: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'catalog-product-id' }));
jest.mock('@/data/local-photo', () => ({ loadLocalPhotos: jest.fn() }));

const product = { id: 'exact-rice', name: 'Example Basmati Rice', productType: 'Dry rice',
  variety: 'Basmati', brand: 'Example', pack: { quantity: 500, unit: 'g' } };
const photo = { uri: 'file:///fixture.jpg', mimeType: 'image/jpeg', width: 100, height: 100 } as const;
const row = (id: string, shop: string, variety: string, brand: string, price: string, productName = id): LocalPhotoDraft => ({
  id, capturedAt: '2026-11-12T10:00:00Z', original: photo, selected: photo,
  review: { ...emptyReview(shop), productName, productType: 'Dry rice', variety, brand, price, packSize: '500 g' },
});

beforeEach(() => {
  jest.resetAllMocks();
});

async function scan(data = '012345678905') {
  await fireEvent(screen.getByTestId('barcode-preview'), 'barcodeScanned', { data });
}

test('opens a known product’s comparisons and filters saved prices by brand and variety', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(product);
  jest.mocked(loadLocalPhotos).mockResolvedValue([
    row('Match both', 'Shop A', 'Basmati', 'Example', '2.50', product.name),
    row('Same brand', 'Shop A', 'Long grain', 'Example', '2.00'),
    row('Same variety', 'Shop B', 'Basmati', 'Different brand', '1.50'),
    { ...row('Other type', 'Shop B', 'Basmati', 'Example', '1.00'),
      review: { ...emptyReview('Shop B'), productName: 'Other type', productType: 'Microwave rice', price: '1.00' } },
  ]);
  await render(<BarcodeScan onScanLabel={jest.fn()} />);
  await scan();

  expect(await screen.findByRole('header', { name: product.name })).toBeOnTheScreen();
  expect(findLocalProductByBarcode).toHaveBeenCalledWith('00012345678905');
  expect(screen.queryByLabelText(`Scan photo for ${product.name}`)).not.toBeOnTheScreen();
  expect(screen.getAllByText(/^£\d.\d\d \/ kg$/).map(price => price.props.accessibilityLabel)).toEqual([
    '£3.00 / kg', '£4.00 / kg', '£5.00 / kg',
  ]);
  expect(screen.queryByText('Other type')).not.toBeOnTheScreen();
  expect(screen.getAllByText('Recorded 12 Nov 2026')).toHaveLength(3);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Same brand' }));
  expect(screen.getByRole('checkbox', { name: 'Same variety' })).toBeOnTheScreen();
  expect(screen.queryByText('£3.00 / kg')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Same variety' }));
  expect(screen.queryByText('£4.00 / kg')).not.toBeOnTheScreen();
  expect(screen.getByText('£5.00 / kg')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Same brand' }));
  expect(screen.getByText('£3.00 / kg')).toBeOnTheScreen();
});

test('uses the completed observation with the explicit product ID as the reference', async () => {
  const linked = row('linked', 'Linked shop', 'Basmati', 'Example', '2.50');
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(product);
  jest.mocked(loadLocalPhotos).mockResolvedValue([{ ...linked, productId: product.id }]);
  await render(<BarcodeScan onScanLabel={jest.fn()} />);
  await scan();

  expect(await screen.findByLabelText(`Scan photo for ${product.name}`)).toBeOnTheScreen();
  expect(screen.getByText('Linked shop')).toBeOnTheScreen();
  expect(screen.getByText('Recorded 12 Nov 2026')).toBeOnTheScreen();
});

test('ignores invalid and repeated scans, then lets the shopper scan again after an unknown code', async () => {
  let finishLookup!: (product: undefined) => void;
  jest.mocked(findLocalProductByBarcode).mockReturnValue(new Promise(resolve => { finishLookup = resolve; }));
  await render(<BarcodeScan onScanLabel={jest.fn()} />);
  await scan('012345678904');
  expect(findLocalProductByBarcode).not.toHaveBeenCalled();
  const onBarcodeScanned = screen.getByTestId('barcode-preview').props.onBarcodeScanned;
  await act(() => {
    void onBarcodeScanned({ data: '012345678905' });
    void onBarcodeScanned({ data: '012345678905' });
  });
  expect(findLocalProductByBarcode).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Looking up barcode')).toBeOnTheScreen();
  expect(screen.queryByTestId('barcode-preview')).not.toBeOnTheScreen();
  await act(() => finishLookup(undefined));

  expect(await screen.findByText('Product not found')).toBeOnTheScreen();
  expect(loadLocalPhotos).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan another barcode' }));
  expect(screen.getByTestId('barcode-preview')).toBeOnTheScreen();
});

test('returns to scanning after save and finds the same product on rescan', async () => {
  const saved = { ...product, id: 'catalog-product-id', barcode: '00012345678905' };
  jest.mocked(findLocalProductByBarcode).mockResolvedValueOnce(undefined).mockResolvedValueOnce(saved);
  jest.mocked(addLocalProduct).mockResolvedValue(saved);
  jest.mocked(loadLocalPhotos).mockResolvedValue([]);
  await render(<BarcodeScan onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Add product' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save product' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a product name and type.');
  expect(addLocalProduct).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Product name'), product.name);
  await fireEvent.changeText(screen.getByLabelText('Product type'), product.productType);
  await fireEvent.changeText(screen.getByLabelText('Pack size (optional)'), '8 × 500 mL');
  await fireEvent.press(screen.getByRole('button', { name: 'Save product' }));
  expect(addLocalProduct).toHaveBeenCalledWith(expect.objectContaining({
    id: saved.id, barcode: saved.barcode, name: product.name, productType: product.productType,
    pack: { quantity: 4000, unit: 'mL', label: '8 × 500 mL' },
  }));
  await scan('0012345678905');
  expect(await screen.findByRole('header', { name: product.name })).toBeOnTheScreen();
});

test('cancels product entry and resumes scanning without saving', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(undefined);
  await render(<BarcodeScan onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Add product' }));
  await fireEvent.changeText(screen.getByLabelText('Product name'), 'Unsaved product');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByTestId('barcode-preview')).toBeOnTheScreen();
  expect(addLocalProduct).not.toHaveBeenCalled();
});
