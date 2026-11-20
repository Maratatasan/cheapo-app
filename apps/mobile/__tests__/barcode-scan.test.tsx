import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BarcodeScan } from '@/component/barcode-scan';
import type { CameraComponent } from '@/component/camera';
import { addLocalProduct, findLocalProductByBarcode, replaceLocalProductBarcode } from '@/data/local-products';
import { emptyReview } from '@/data/photo-review';
import { loadSavedPriceRecords, saveManualPrice, type LocalPhotoDraft, type ManualPriceRecord } from '@/data/local-photo';
import type { PriceHistoryQuery, PriceObservationDetail } from '@cheapo/domain/price-history';

const mockPush = jest.fn();
const mockUseCheapoShopping = jest.fn();
const mockReadProductPhoto = jest.fn();
const mockCatalog = jest.fn();
const mockOpenHistory = jest.fn();
const mockComparisonPreference = jest.fn();
const mockCacheClear = new Set<() => void>();
const mockCameraProps = jest.fn<unknown, [Parameters<typeof CameraComponent>[0]]>();
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
jest.mock('@/data/local-products', () => ({ addLocalProduct: jest.fn(), findLocalProductByBarcode: jest.fn(), replaceLocalProductBarcode: jest.fn() }));
jest.mock('@/data/local-photo', () => ({ loadSavedPriceRecords: jest.fn(), saveManualPrice: jest.fn() }));
jest.mock('@/component/cheapo-shopping-provider', () => ({ useCheapoShopping: () => mockUseCheapoShopping() }));
jest.mock('@/hooks/use-enrolled-catalog', () => ({ useEnrolledCatalog: () => mockCatalog() }));
jest.mock('@/hooks/use-comparison-preference', () => ({
  useComparisonPreference: (...args: unknown[]) => mockComparisonPreference(...args),
}));
jest.mock('@/data/cheapo-shopping-read-device', () => ({ openCheapoSavedPriceReads: () => mockOpenHistory() }));
jest.mock('@/data/product-presentation-photos-device', () => ({
  openProductPresentationPhotos: () => ({ read: mockReadProductPhoto }),
}));
jest.mock('@/data/cheapo-shopping-read-cache', () => ({ cheapoShoppingReadCache: {
  subscribeClear: (listener: () => void) => { mockCacheClear.add(listener); return () => mockCacheClear.delete(listener); },
} }));
jest.mock('@/component/camera', () => ({ CameraComponent: (props: Parameters<typeof CameraComponent>[0]) => {
  const { Button } = require('react-native');
  mockCameraProps(props);
  return <Button title="Return from photo" onPress={(props.barcodeCapture ?? props.linkedPrice)?.onCancel} />;
} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'manual-price-id' }));

const currentShop = { id: 'selected-shop', displayName: 'Selected shop' };
const owner = { origin: 'https://cheapo.example', householdId: 'household', shopperId: 'shopper' };
const product = { id: 'exact-rice', name: 'Example Basmati Rice', productType: 'Dry rice',
  variety: 'Basmati', brand: 'Example', pack: { quantity: 500, unit: 'g' } };
const photo = { uri: 'file:///fixture.jpg', mimeType: 'image/jpeg', width: 100, height: 100 } as const;
const sharedExact: PriceObservationDetail = {
  id: '46015e30-3c63-43b8-aaf2-37bd3635df8e', sourceId: 'source-1', ownedByCurrentShopper: true,
  version: 2, capturedAt: '2026-11-20T10:30:00.000000Z', productId: product.id, sourceProductId: product.id,
  productName: product.name, shopId: currentShop.id, sourceShopId: currentShop.id, shopDisplayName: currentShop.displayName,
  priceAmount: '3.00', currency: 'GBP', review: { productType: product.productType, packSize: '500 g' },
  unitPrice: { amount: 6, unit: 'kg' }, photos: [], selectedPhotoRole: null, cropBox: null,
};
const row = (id: string, shop: string, variety: string, brand: string, price: string, productName = id): LocalPhotoDraft => ({
  id, capturedAt: '2026-11-12T10:00:00Z', original: photo, selected: photo,
  review: { ...emptyReview(shop), productName, productType: 'Dry rice', variety, brand, price, packSize: '500 g' },
});

beforeEach(() => {
  jest.resetAllMocks();
  mockUseCheapoShopping.mockReturnValue(null);
  mockReadProductPhoto.mockResolvedValue({ status: 'unavailable' });
  mockCatalog.mockReturnValue(null);
  mockComparisonPreference.mockReturnValue(undefined);
  mockOpenHistory.mockResolvedValue({ loadPriceHistory: jest.fn(async () => ({ status: 'unavailable' })), assertCurrent: jest.fn() });
});

async function scan(data = '012345678905') {
  await fireEvent(screen.getByTestId('barcode-preview'), 'barcodeScanned', { data });
}

test('rescans a proposed barcode and saves it only after confirmation for the named product', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(product);
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  jest.mocked(replaceLocalProductBarcode).mockResolvedValue({ ...product, barcode: '04006381333931' });
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit barcode' }));
  expect(screen.getByText(product.name)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan barcode' }));
  await scan('4006381333931');

  expect(screen.getByText('Proposed barcode 04006381333931')).toBeOnTheScreen();
  expect(replaceLocalProductBarcode).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save barcode' }));
  expect(replaceLocalProductBarcode).toHaveBeenCalledWith(product.id, '00012345678905', '04006381333931');
  expect(screen.getByText('Barcode 04006381333931')).toBeOnTheScreen();
});

test('validates and corrects a lookup without writing to the displayed product', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValueOnce(product).mockResolvedValueOnce(undefined);
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Correct lookup code' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Enter manually' }));
  await fireEvent.changeText(screen.getByLabelText('Proposed barcode'), '00012345678904');
  await fireEvent.press(screen.getByRole('button', { name: 'Look up barcode' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid product barcode.');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('header', { name: product.name })).toBeOnTheScreen();
  expect(findLocalProductByBarcode).toHaveBeenCalledTimes(1);

  await fireEvent.press(screen.getByRole('button', { name: 'Correct lookup code' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Enter manually' }));
  await fireEvent.changeText(screen.getByLabelText('Proposed barcode'), '4006381333931');
  await fireEvent.press(screen.getByRole('button', { name: 'Look up barcode' }));
  expect(await screen.findByText('Product not found')).toBeOnTheScreen();
  expect(findLocalProductByBarcode).toHaveBeenLastCalledWith('04006381333931');
  expect(replaceLocalProductBarcode).not.toHaveBeenCalled();
  expect(addLocalProduct).not.toHaveBeenCalled();
});

test('keeps a saved correction proposal after a conflicting barcode and allows cancellation', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(product);
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  jest.mocked(replaceLocalProductBarcode).mockRejectedValue(Error('This barcode belongs to Example brown rice.'));
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit barcode' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Enter manually' }));
  await fireEvent.changeText(screen.getByLabelText('Proposed barcode'), '04006381333931');
  await fireEvent.press(screen.getByRole('button', { name: 'Save barcode' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This barcode belongs to Example brown rice.');
  expect(screen.getByLabelText('Proposed barcode')).toHaveDisplayValue('04006381333931');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Barcode 00012345678905')).toBeOnTheScreen();
});

test.each([undefined, currentShop])('opens sorted saved-price comparisons for a known product (shop: %j)', async shop => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(product);
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([
    row('Match both', 'Shop A', 'Basmati', 'Example', '2.50', product.name),
    row('Same brand', 'Shop A', 'Long grain', 'Example', '2.00'),
    row('Same variety', 'Shop B', 'Basmati', 'Different brand', '1.50'),
    { ...row('Other type', 'Shop B', 'Basmati', 'Example', '1.00'),
      review: { ...emptyReview('Shop B'), productName: 'Other type', productType: 'Microwave rice', price: '1.00' } },
  ]);
  await render(<BarcodeScan currentShop={shop} onScanLabel={jest.fn()} />);
  await scan();

  expect(await screen.findByRole('header', { name: product.name })).toBeOnTheScreen();
  expect(findLocalProductByBarcode).toHaveBeenCalledWith('00012345678905');
  expect(screen.queryByLabelText(`Scan photo for ${product.name}`)).not.toBeOnTheScreen();
  expect(screen.getAllByText(/^£\d.\d\d \/ kg$/).map(price => price.props.accessibilityLabel)).toEqual([
    '£3.00 / kg', '£4.00 / kg', '£5.00 / kg',
  ]);
  expect(screen.queryByText('Other type')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Add product' })).not.toBeOnTheScreen();
  if (shop) expect(screen.getByRole('button', { name: 'Add price' })).toBeOnTheScreen();
  else expect(screen.queryByRole('button', { name: 'Add price' })).not.toBeOnTheScreen();
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

test('compares the lookup code passed from photo review and offers the first price at this shop', async () => {
  const barcode = '00012345678905';
  jest.mocked(findLocalProductByBarcode).mockResolvedValue({ ...product, barcode });
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([
    { ...row('other-shop', 'Other shop', 'Basmati', 'Example', '2.50', product.name), productId: product.id },
  ]);

  await render(<BarcodeScan currentShop={currentShop} initialBarcode={barcode} onScanLabel={jest.fn()} />);

  expect(await screen.findByRole('header', { name: product.name })).toBeOnTheScreen();
  expect(screen.getByText('Other shop')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Add price' }));
  expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('');
  expect(findLocalProductByBarcode).toHaveBeenCalledWith(barcode);
  expect(addLocalProduct).not.toHaveBeenCalled();
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

test('saves one reviewed price durably for the enrolled shopper and reopens it before upload', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(product);
  let saved: ManualPriceRecord | undefined;
  const saveManual = jest.fn<Promise<ManualPriceRecord>, [ManualPriceRecord]>()
    .mockRejectedValueOnce(Error('Could not commit the local price'))
    .mockImplementation(async record => { saved = record; return record; });
  const retry = jest.fn(async () => { expect(saved).toBeDefined(); });
  const readPriceSaveStatus = jest.fn(async () => 'waiting').mockResolvedValueOnce('waiting').mockResolvedValueOnce('synced');
  let refreshReceipt: (() => void) | undefined;
  mockUseCheapoShopping.mockReturnValue({
    owner, assertOwner: jest.fn(async () => {}),
    priceRecords: { saveManual },
    priceQueue: { read: jest.fn(async () => ({ entries: saved ? [{ record: saved }] : [] })) },
    loadPriceChanges: jest.fn(async () => []),
    subscribeSync: (callback: () => void) => { refreshReceipt = callback; return jest.fn(); },
    readPriceSaveStatus, retry,
  });
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Add price' }));
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '1.95');
  await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save this price/);
  expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('1.95');
  expect(retry).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Save Price' }));
  expect(saveManual.mock.calls[1][0]).toEqual(saveManual.mock.calls[0][0]);
  expect(saved).toMatchObject({ id: 'manual-price-id', productId: product.id, shop: currentShop, review: { price: '1.95' } });
  expect(retry).toHaveBeenCalledTimes(1);
  expect(saveManualPrice).not.toHaveBeenCalled();
  expect(screen.getByText('Saved on this phone · Waiting to sync')).toBeOnTheScreen();
  await act(() => { refreshReceipt?.(); });
  expect(screen.getByText('Synced to Cheapo')).toBeOnTheScreen();
  expect(readPriceSaveStatus).toHaveBeenCalledWith('manual-price-id');

  await scan();
  expect(screen.getByText('£1.95 pack')).toBeOnTheScreen();
  expect(screen.queryByText('Saved on this phone · Waiting to sync')).not.toBeOnTheScreen();
  expect(loadSavedPriceRecords).toHaveBeenCalled();
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

test('carries an unknown barcode into product entry without a shop or an automatic save', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(undefined);
  await render(<BarcodeScan onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Add product' }));
  expect(screen.getByText('Barcode 00012345678905')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Add product and price from photo' })).not.toBeOnTheScreen();
  expect(addLocalProduct).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Product name'), 'Unsaved product');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByTestId('barcode-preview')).toBeOnTheScreen();
  expect(addLocalProduct).not.toHaveBeenCalled();
});


test('shows the catalog barcode in known price entry and passes it to linked photo review', async () => {
  const barcode = '00012345678905';
  jest.mocked(findLocalProductByBarcode).mockResolvedValue({ ...product, barcode });
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Add price' }));
  expect(screen.getByText(barcode)).toBeOnTheScreen();
  expect(screen.queryByLabelText('Product barcode')).not.toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '1.95');
  await fireEvent.press(screen.getByRole('button', { name: 'Scan shelf label' }));
  expect(mockCameraProps).toHaveBeenCalledWith(expect.objectContaining({
    currentShop,
    linkedPrice: expect.objectContaining({ productId: product.id, barcode, initialReview: expect.objectContaining({ price: '1.95' }) }),
  }));
  expect(addLocalProduct).not.toHaveBeenCalled();
});

test('opens a price photo with the unknown scan and keeps Add product fields when cancelled', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(undefined);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Add product' }));
  await fireEvent.changeText(screen.getByLabelText('Product name'), 'Entered name');
  await fireEvent.press(screen.getByRole('button', { name: 'Add product and price from photo' }));
  expect(mockCameraProps).toHaveBeenCalledWith(expect.objectContaining({
    currentShop,
    barcodeCapture: expect.objectContaining({ barcode: '00012345678905', initialReview: expect.objectContaining({ productName: 'Entered name', price: '' }) }),
  }));
  expect(screen.queryByLabelText('Product name')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Return from photo' }));
  expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Entered name');
  expect(addLocalProduct).not.toHaveBeenCalled();
  expect(saveManualPrice).not.toHaveBeenCalled();
});

test('checks the enrolled catalog and commits a barcode correction against the displayed product', async () => {
  const displayed = { ...product, barcode: '00012345678905', catalogBase: { kind: 'version', version: 7 } };
  const corrected = { ...displayed, barcode: '04006381333931' };
  const findByBarcode = jest.fn(async () => displayed);
  const replaceBarcode = jest.fn(async () => corrected);
  mockCatalog.mockReturnValue({ findByBarcode, replaceBarcode });
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit barcode' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Enter manually' }));
  await fireEvent.changeText(screen.getByLabelText('Proposed barcode'), '4006381333931');
  await fireEvent.press(screen.getByRole('button', { name: 'Save barcode' }));
  expect(findByBarcode).toHaveBeenCalledWith(displayed.barcode, expect.anything());
  expect(replaceBarcode).toHaveBeenCalledWith(displayed, corrected.barcode);
  expect(replaceLocalProductBarcode).not.toHaveBeenCalled();
  expect(findLocalProductByBarcode).not.toHaveBeenCalled();
  expect(screen.getByText(`Barcode ${corrected.barcode}`)).toBeOnTheScreen();
});

test('queues a new enrolled product after a checked barcode miss', async () => {
  const save = jest.fn(async () => product);
  mockCatalog.mockReturnValue({ findByBarcode: jest.fn(async () => undefined), save });
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  await fireEvent.press(screen.getByRole('button', { name: 'Add product' }));
  await fireEvent.changeText(screen.getByLabelText('Product name'), product.name);
  await fireEvent.changeText(screen.getByLabelText('Product type'), product.productType);
  await fireEvent.press(screen.getByRole('button', { name: 'Save product' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: product.name, barcode: '00012345678905' }));
  expect(addLocalProduct).not.toHaveBeenCalled();
});

test('explains why an enrolled offline barcode could not be checked without offering to create it', async () => {
  const response = Promise.withResolvers<typeof product>();
  mockCatalog.mockReturnValue({ findByBarcode: () => response.promise });
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  expect(screen.getByText('Checking the shared catalog.')).toBeOnTheScreen();
  await act(() => { response.reject(Error('Could not check this product offline. Try again when you’re connected.')); });
  expect(screen.getByText(/Could not check this product offline/)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Add product' })).not.toBeOnTheScreen();
  expect(findLocalProductByBarcode).not.toHaveBeenCalled();
});

test('loads bounded exact and comparable shared price pages and opens the correct remote edit', async () => {
  const catalogProduct = { ...product, barcode: '00012345678905', comparableGroupId: 'dry-rice' };
  const own: PriceObservationDetail = {
    ...sharedExact, ownedByCurrentShopper: false, selectedPhotoRole: 'original',
    photos: [{ role: 'original', width: 100, height: 100 }],
  };
  const peer = { ...own, id: '89659f1e-ca13-4ba1-84bc-f07a4fa84591', sourceId: 'source-2', ownedByCurrentShopper: false,
    productId: 'other-rice', productName: 'Reviewed rice', shopId: 'peer-shop', shopDisplayName: 'Peer shop',
    priceAmount: '2.00', unitPrice: { amount: 4, unit: 'kg' } };
  const loadPriceHistory = jest.fn(async (query: PriceHistoryQuery) => ({
    status: query.productId ? 'fresh' : 'cached', lastSyncedAt: '2026-11-20T10:45:00.000Z',
    value: { observations: query.cursor ? [] : query.productId ? [own] : [own, peer], nextCursor: query.cursor ? null : 'cursor' },
  }));
  const loadPriceObservation = jest.fn(async () => ({ status: 'fresh', value: { observation: own } }));
  const loadSelectedPhoto = jest.fn(async () => ({ status: 'fresh', value: { uri: photo.uri } }));
  mockComparisonPreference.mockImplementation((_shopping, group) => group === 'dry-rice'
    ? { basis: '100g', checked: true, saving: false, loading: false, choose: jest.fn() } : undefined);
  mockOpenHistory.mockResolvedValue({ loadPriceHistory, loadPriceObservation, loadSelectedPhoto, assertCurrent: jest.fn() });
  mockCatalog.mockReturnValue({ findByBarcode: jest.fn(async () => catalogProduct) });
  mockUseCheapoShopping.mockReturnValue({
    owner, assertOwner: jest.fn(async () => {}), priceQueue: { read: jest.fn(async () => ({ entries: [] })) },
    loadPriceChanges: jest.fn(async () => [{
      state: 'waiting', resourceId: own.id,
      change: { action: 'correct', review: { productName: product.name, productType: product.productType, price: '3.00', currency: 'GBP' },
        unitPrice: { amount: 6, unit: 'kg' }, photoSelection: { role: 'crop', cropBox: { left: 0.1, right: 0.7, top: 0.1, bottom: 0.8 } } },
    }]),
  });
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  expect(loadPriceHistory).toHaveBeenCalledWith({ productId: product.id, limit: 25, cursor: undefined }, expect.anything());
  expect(loadPriceHistory).toHaveBeenCalledWith({ productType: product.productType, comparableGroupId: 'dry-rice', limit: 25, cursor: undefined }, expect.anything());
  expect(screen.getByText('£3.00 pack')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Per 100 g', checked: true })).toBeOnTheScreen();
  expect(screen.getByLabelText('£0.40 / 100 g')).toBeOnTheScreen();
  expect(screen.getByText(/Last synced/)).toBeOnTheScreen();
  expect(await screen.findByLabelText(`Scan photo for ${product.name}`)).toBeOnTheScreen();
  expect(loadPriceObservation).toHaveBeenCalledWith(own.id, expect.anything());
  expect(loadSelectedPhoto).toHaveBeenCalledTimes(1);
  expect(loadSelectedPhoto).toHaveBeenCalledWith(expect.objectContaining({
    id: own.id, cropSource: 'original', selectedPhotoRole: 'crop', cropBox: { left: 0.1, right: 0.7, top: 0.1, bottom: 0.8 },
  }), 'crop', expect.anything());
  await fireEvent.press(screen.getByRole('button', { name: /Edit Reviewed rice at Peer shop/ }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/edit-price/[id]', params: { source: 'shared', id: peer.id } });
  await fireEvent.press(screen.getByRole('button', { name: 'Load more saved prices' }));
  expect(loadPriceHistory).toHaveBeenCalledWith({ productId: product.id, limit: 25, cursor: 'cursor' }, expect.anything());
  expect(screen.queryByRole('button', { name: 'Load more saved prices' })).not.toBeOnTheScreen();
});

test('compares an explicit kept cloud correction only when the corresponding shared scope is offline', async () => {
  const loadPriceHistory = jest.fn().mockResolvedValue({ status: 'unavailable' });
  mockOpenHistory.mockResolvedValue({ loadPriceHistory, assertCurrent: jest.fn() });
  mockCatalog.mockReturnValue({ findByBarcode: jest.fn(async () => product) });
  mockUseCheapoShopping.mockReturnValue({
    owner, assertOwner: jest.fn(async () => {}), priceQueue: { read: jest.fn(async () => ({ entries: [] })) },
    loadPriceChanges: jest.fn(async () => [
      { state: 'acknowledged', resourceId: sharedExact.id, acceptedVersion: sharedExact.version,
        change: { action: 'keep_cloud', observation: sharedExact } },
    ]),
  });
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  expect(screen.getByText('£3.00 pack')).toBeOnTheScreen();
  expect(screen.getByText('Shared comparisons unavailable')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan another barcode' }));
  loadPriceHistory.mockResolvedValue({ status: 'fresh', lastSyncedAt: '2026-11-20T11:00:00.000Z',
    value: { observations: [], nextCursor: null } });
  await scan();
  expect(screen.queryByText('£3.00 pack')).not.toBeOnTheScreen();
  expect(screen.getByText('No price saved at this shop')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan another barcode' }));
  loadPriceHistory.mockRejectedValue(new Error('Access denied'));
  await scan();
  expect(screen.getByText('Couldn’t look up barcode')).toBeOnTheScreen();
  expect(screen.queryByText('£3.00 pack')).not.toBeOnTheScreen();
});

test('clears shared pages and an in-flight photo while keeping an already saved phone price', async () => {
  const sharedPhoto = { ...sharedExact, selectedPhotoRole: 'original', photos: [{ role: 'original', width: 100, height: 100 }] };
  const local: ManualPriceRecord = { id: 'phone-price', capturedAt: '2026-11-19T11:00:00Z', shop: currentShop,
    productId: product.id, review: { ...emptyReview(currentShop.displayName), productName: product.name,
      productType: product.productType, price: '1.75', packSize: '500 g' } };
  const transfer = Promise.withResolvers<{ status: 'fresh'; value: { uri: string } }>();
  const productTransfer = Promise.withResolvers<{ status: 'fresh'; photo: { uri: string } }>();
  mockReadProductPhoto.mockResolvedValueOnce({ status: 'cached', photo: { uri: 'file:///product-cache.jpg' } })
    .mockImplementationOnce(() => productTransfer.promise);
  let photoSignal: AbortSignal | undefined;
  const loadSelectedPhoto = jest.fn((_observation, _role, signal: AbortSignal) => {
    photoSignal = signal;
    return transfer.promise;
  });
  const loadPriceHistory = jest.fn(async () => ({ status: 'cached', lastSyncedAt: '2026-11-20T11:00:00.000Z',
    value: { observations: [sharedPhoto], nextCursor: 'older-page' } }));
  mockOpenHistory.mockResolvedValue({ loadPriceHistory, loadSelectedPhoto, assertCurrent: jest.fn(),
    loadPriceObservation: jest.fn(async () => ({ status: 'cached', value: { observation: sharedPhoto } })) });
  mockCatalog.mockReturnValue({ findByBarcode: jest.fn(async () => product) });
  mockUseCheapoShopping.mockReturnValue({
    owner, assertOwner: jest.fn(async () => {}),
    priceQueue: { read: jest.fn(async () => ({ entries: [{ record: local }] })) },
    loadPriceChanges: jest.fn(async () => []),
  });
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([]);
  await render(<BarcodeScan currentShop={currentShop} onScanLabel={jest.fn()} />);
  await scan();
  const productLabel = `Product photo for ${product.name}`;
  expect(await screen.findByLabelText(productLabel)).toHaveProp('source', { uri: 'file:///product-cache.jpg' });
  expect(mockReadProductPhoto).toHaveBeenCalledWith(product.id, expect.any(AbortSignal), 'cache-only');
  expect(screen.getByText('£3.00 pack')).toBeOnTheScreen();
  expect(loadSelectedPhoto).toHaveBeenCalledTimes(1);
  await act(() => { for (const listener of mockCacheClear) listener(); });
  expect(photoSignal?.aborted).toBe(true);
  expect(mockReadProductPhoto.mock.calls[1][1].aborted).toBe(true);
  expect(screen.queryByText(/Last synced/)).not.toBeOnTheScreen();
  expect(screen.queryByText('£3.00 pack')).not.toBeOnTheScreen();
  expect(screen.getByText('£1.75 pack')).toBeOnTheScreen();
  await act(() => transfer.resolve({ status: 'fresh', value: { uri: photo.uri } }));
  await act(() => productTransfer.resolve({ status: 'fresh', photo: { uri: 'file:///late-product.jpg' } }));
  expect(screen.queryByLabelText(`Scan photo for ${product.name}`)).not.toBeOnTheScreen();
  expect(screen.queryByLabelText(productLabel)).not.toBeOnTheScreen();
  expect(loadPriceHistory).toHaveBeenCalledTimes(2);
});
