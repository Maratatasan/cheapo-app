import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BarcodeScan } from '@/component/barcode-scan';
import { addLocalProduct, findLocalProductByBarcode } from '@/data/local-products';
import { emptyReview } from '@/data/photo-review';
import { loadSavedPriceRecords, saveManualPrice, type LocalPhotoDraft } from '@/data/local-photo';

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
jest.mock('@/data/local-photo', () => ({ loadSavedPriceRecords: jest.fn(), saveManualPrice: jest.fn() }));
jest.mock('@/component/camera', () => ({ CameraComponent: () => null }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'manual-price-id' }));

const currentShop = { id: 'selected-shop', displayName: 'Selected shop' };
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
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([
    row('Match both', 'Shop A', 'Basmati', 'Example', '2.50', product.name),
    row('Same brand', 'Shop A', 'Long grain', 'Example', '2.00'),
    row('Same variety', 'Shop B', 'Basmati', 'Different brand', '1.50'),
    { ...row('Other type', 'Shop B', 'Basmati', 'Example', '1.00'),
      review: { ...emptyReview('Shop B'), productName: 'Other type', productType: 'Microwave rice', price: '1.00' } },
  ]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
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
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([{ ...linked, productId: product.id }]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();

  expect(await screen.findByLabelText(`Scan photo for ${product.name}`)).toBeOnTheScreen();
  expect(screen.getByText('Linked shop')).toBeOnTheScreen();
  expect(screen.getByText('Recorded 12 Nov 2026')).toBeOnTheScreen();
});

test('ignores invalid and repeated scans, then lets the shopper scan again after an unknown code', async () => {
  let finishLookup!: (product: undefined) => void;
  jest.mocked(findLocalProductByBarcode).mockReturnValue(new Promise(resolve => { finishLookup = resolve; }));
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
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
  expect(loadSavedPriceRecords).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan another barcode' }));
  expect(screen.getByTestId('barcode-preview')).toBeOnTheScreen();
});

test.each([false, true])('records a new price for only the selected shop (existing: %s)', async existing => {
  const other = { ...row('other', 'Another shop', 'Basmati', 'Example', '2.50'),
    productId: product.id, shop: { id: 'other-shop', displayName: 'Another shop' } };
  const saved = { ...row('existing', currentShop.displayName, 'Basmati', 'Example', '2.75'),
    productId: product.id, shop: currentShop, capturedAt: '2026-11-13T10:00:00Z' };
  const differentProduct = { ...saved, id: 'different-product', productId: 'other-product' };
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(product);
  jest.mocked(loadSavedPriceRecords).mockResolvedValue(existing ? [saved, other] : [differentProduct, other]);
  jest.mocked(saveManualPrice).mockImplementation(async record => record);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();

  if (existing) expect(screen.getByText('£2.75 pack')).toBeOnTheScreen();
  else expect(screen.getByText('No price saved at this shop')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: existing ? 'Update price' : 'Add price' }));
  expect(screen.getByRole('button', { name: 'Save Price' })).toBeDisabled();
  expect(screen.getByLabelText('Confirmed shop: Selected shop')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '1.95');
  await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));

  expect(saveManualPrice).toHaveBeenCalledWith({
    id: 'manual-price-id', capturedAt: expect.any(String), productId: product.id, shop: currentShop,
    review: expect.objectContaining({ productName: product.name, price: '1.95', packSize: '500 g' }),
  });
  expect(screen.getByTestId('barcode-preview')).toBeOnTheScreen();
});

test('keeps entered details after a failed manual save and retries the same record', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(product);
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  jest.mocked(saveManualPrice).mockRejectedValueOnce(Error('Disk full')).mockImplementationOnce(async record => record);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Add price' }));
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '1.95');
  await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/Your entries are still here\./);
  expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('1.95');
  await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
  expect(screen.getByTestId('barcode-preview')).toBeOnTheScreen();
  expect(jest.mocked(saveManualPrice).mock.calls.map(([record]) => record.id)).toEqual(['manual-price-id', 'manual-price-id']);
});

test('returns to scanning after save and finds the same product on rescan', async () => {
  const saved = { ...product, pack: { quantity: 4000, unit: 'mL', label: '8 × 500 mL' }, id: 'manual-price-id', barcode: '00012345678905' };
  jest.mocked(findLocalProductByBarcode).mockResolvedValueOnce(undefined).mockResolvedValueOnce(saved);
  jest.mocked(addLocalProduct).mockResolvedValue(saved);
  jest.mocked(saveManualPrice).mockImplementation(async record => record);
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
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
  expect(screen.getByText('8 × 500 mL')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Add price' }));
  expect(screen.getByLabelText('Pack size')).toHaveDisplayValue('8 × 500 mL');
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '3.20');
  await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
  expect(saveManualPrice).toHaveBeenCalledWith(expect.objectContaining({
    productId: saved.id, shop: currentShop, review: expect.objectContaining({ packSize: '8 × 500 mL', price: '3.20' }),
  }));
  expect(screen.getByTestId('barcode-preview')).toBeOnTheScreen();
});

test('cancels product entry and resumes scanning without saving', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(undefined);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Add product' }));
  await fireEvent.changeText(screen.getByLabelText('Product name'), 'Unsaved product');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByTestId('barcode-preview')).toBeOnTheScreen();
  expect(addLocalProduct).not.toHaveBeenCalled();
});
