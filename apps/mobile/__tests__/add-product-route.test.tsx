import { fireEvent, render, screen } from '@testing-library/react-native';

import AddProductScreen from '@/app/add-product';
import { addProductPhotoSources } from '@/data/photo-price-source';
import type { CheapoShoppingRuntime } from '@/data/shopping-sync-runtime';

const mockStage = jest.fn();
const mockConfirm = jest.fn();
const mockRetry = jest.fn();
const mockFindByBarcode = jest.fn();
const mockFindCandidates = jest.fn();
const mockChoosePhoto = jest.fn();
const mockTakePhoto = jest.fn();
const mockLoadPrices = jest.fn();
let mockId = 0;
let mockPhotoSource: string | undefined;
const mockShop = { id: 'sample-market', name: 'Sample Market' };
const mockShopping = { owner: { householdId: 'sample-household', shopperId: 'sample-shopper', origin: 'https://cheapo.example' },
  productPrices: { stage: mockStage, confirm: mockConfirm }, retry: mockRetry };
const mockCatalog = { findByBarcode: mockFindByBarcode };
const mockShops = { shops: [mockShop], currentShop: mockShop };

jest.mock('expo-crypto', () => ({ randomUUID: () => `add-id-${++mockId}` }));
jest.mock('expo-camera', () => ({ useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ photoSource: mockPhotoSource }), Stack: { Screen: () => null }, Redirect: () => null }));
jest.mock('@/component/photo-barcode-scan', () => ({ PhotoBarcodeScan: ({ onRead }: { onRead: (code: string) => void }) => {
  const { Button } = require('react-native');
  return <Button title="Detected barcode in camera fixture" onPress={() => onRead('036000291452')} />;
} }));
jest.mock('@/component/cheapo-shopping-provider', () => ({ useCheapoShopping: () => mockShopping }));
jest.mock('@/hooks/use-enrolled-catalog', () => ({ useEnrolledCatalog: () => mockCatalog }));
jest.mock('@/hooks/use-saved-shops', () => ({ useSavedShops: () => ({ shops: mockShops }) }));
jest.mock('@/lib/choose-photo', () => ({ choosePhoto: () => mockChoosePhoto(), takePhoto: () => mockTakePhoto() }));
jest.mock('@/lib/cheapo-access/config', () => ({ fieldCheapoApiOrigin: () => 'https://cheapo.example' }));
jest.mock('@/data/cheapo-shopping-read-device', () => ({ createOwnerShoppingReads: () => ({ searchProductCandidates: mockFindCandidates }) }));
jest.mock('@/data/barcode-shared-prices', () => ({ loadSharedBarcodePrices: (...args: unknown[]) => mockLoadPrices(...args) }));

beforeEach(() => {
  mockId = 0;
  mockPhotoSource = undefined;
  addProductPhotoSources.clear();
  mockStage.mockReset().mockResolvedValue(undefined);
  mockConfirm.mockReset().mockResolvedValue(undefined);
  mockRetry.mockReset().mockResolvedValue(undefined);
  mockFindByBarcode.mockReset().mockResolvedValue(undefined);
  mockFindCandidates.mockReset().mockResolvedValue({ status: 'fresh', value: { candidates: [], truncated: false } });
  mockChoosePhoto.mockReset();
  mockTakePhoto.mockReset();
  mockLoadPrices.mockReset().mockResolvedValue({ history: {} });
});

async function enterPrice() {
  await fireEvent.changeText(screen.getByLabelText('Product name'), 'Sample tea');
  await fireEvent.changeText(screen.getByLabelText('Product type'), 'Tea');
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.35');
}

test('stages the complete reviewed shop price before confirming the new product', async () => {
  mockStage.mockRejectedValueOnce(Error('Store busy'));
  await render(<AddProductScreen />);
  await enterPrice();
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Add as new product' }));
  expect(mockStage).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm current price' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Your details are still here/);
  expect(mockConfirm).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm current price' }));
  expect(await screen.findByText(/Waiting to sync/)).toBeOnTheScreen();
  expect(mockStage.mock.calls[1][0]).toEqual(mockStage.mock.calls[0][0]);
  expect(mockStage).toHaveBeenLastCalledWith(expect.objectContaining({ catalogOperationId: 'add-id-3',
    record: expect.objectContaining({ id: 'add-id-1', productId: 'add-id-2',
      review: expect.objectContaining({ productName: 'Sample tea', productType: 'Tea', price: '2.35' }),
      shop: { id: mockShop.id, displayName: mockShop.name } }) }));
  expect(mockConfirm).toHaveBeenCalledWith('add-id-1', { kind: 'add' });
  expect(mockRetry).toHaveBeenCalledTimes(1);
});

test('saves an offline photo review with its original and price, without creating or confirming a product', async () => {
  const asset = { uri: 'file:///sample.jpg', width: 800, height: 600, mimeType: 'image/jpeg' };
  mockChoosePhoto.mockResolvedValue(asset);
  mockFindCandidates.mockResolvedValue({ status: 'unavailable' });
  await render(<AddProductScreen />);
  await enterPrice();
  await fireEvent.press(screen.getByRole('button', { name: 'Choose photo' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Save draft for review' }));
  expect(await screen.findByText('Draft saved · Review in Pending sync')).toBeOnTheScreen();
  expect(mockStage).toHaveBeenCalledWith(expect.objectContaining({ record: expect.objectContaining({
    original: asset, selected: asset, review: expect.objectContaining({ price: '2.35', productType: 'Tea' }),
  }) }));
  expect(mockConfirm).not.toHaveBeenCalled();
  expect(mockRetry).not.toHaveBeenCalled();
});

test('reuse confirms the canonical product and selected shop without proposing a new catalog product', async () => {
  const product = { id: 'canonical-tea', name: 'Market Tea', brand: 'Market', variety: 'Breakfast',
    productType: 'Black tea', pack: { quantity: 80, unit: 'g', label: '80 g' },
    barcode: '00036000291452', comparableGroupId: 'tea-group' };
  mockFindByBarcode.mockResolvedValue(product);
  mockLoadPrices.mockResolvedValue({ history: {}, currentPrice: { price: 2.35, currency: 'GBP', capturedOn: '2026-11-16' } });
  await render(<AddProductScreen />);
  await enterPrice();
  await fireEvent.changeText(screen.getByLabelText('Brand'), 'Other maker');
  await fireEvent.changeText(screen.getByLabelText('Pack size'), '100 g');
  await fireEvent.changeText(screen.getByLabelText('Product barcode (optional)'), '036000291452');
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Use Market Tea' }));
  expect(await screen.findByText('Last recorded at Sample Market · £2.35 · 16 Nov 2026')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Product name')).not.toBeOnTheScreen();
  expect(screen.queryByLabelText('Brand')).not.toBeOnTheScreen();
  expect(screen.queryByLabelText('Product type')).not.toBeOnTheScreen();
  expect(screen.getByLabelText('Pack size')).toHaveDisplayValue('80 g');
  expect(mockLoadPrices).toHaveBeenCalledWith(mockShopping, product, mockShop.id, expect.any(AbortSignal));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm current price' }));
  expect(mockConfirm).toHaveBeenCalledWith('add-id-1', { kind: 'reuse', productId: product.id });
  expect(mockStage).toHaveBeenCalledWith(expect.objectContaining({ record: expect.objectContaining({ productId: product.id,
    review: expect.objectContaining({ brand: product.brand, variety: product.variety, productType: product.productType, packSize: '80 g' }),
  }) }));
  expect(mockFindCandidates).not.toHaveBeenCalled();
});

test('feeds a dedicated live scan into the same Add lookup without replacing other fields', async () => {
  await render(<AddProductScreen />);
  await enterPrice();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan barcode' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Detected barcode in camera fixture' }));
  expect(screen.getByLabelText('Product barcode (optional)')).toHaveDisplayValue('036000291452');
  expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Sample tea');
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  expect(mockFindByBarcode).toHaveBeenCalledWith('00036000291452', expect.any(AbortSignal));
  expect(mockStage).not.toHaveBeenCalled();
});

test('carries the same camera photo, reviewed metadata and stable source into Add before saving the shop price', async () => {
  mockPhotoSource = 'camera-draft';
  const image = { uri: 'file:///package.jpg', mimeType: 'image/jpeg' as const, width: 800, height: 600 };
  const draft = { id: mockPhotoSource, capturedAt: '2026-11-20T11:00:00.000Z', original: image,
    selected: { ...image, uri: 'file:///crop.jpg' } };
  addProductPhotoSources.set(mockPhotoSource, { owner: mockShopping as unknown as CheapoShoppingRuntime, draft,
    details: { barcode: '036000291452', review: { productName: 'Package oats', productType: 'Oats', brand: 'Sample' } } });
  const view = await render(<AddProductScreen />);
  expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Package oats');
  expect(screen.getByLabelText('Product type')).toHaveDisplayValue('Oats');
  expect(screen.getByLabelText('Product barcode (optional)')).toHaveDisplayValue('036000291452');
  expect(screen.getByLabelText('Price photo preview')).toHaveProp('source', { uri: 'file:///crop.jpg' });
  expect(mockStage).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '3.19');
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Add as new product' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm current price' }));
  expect(mockStage).toHaveBeenCalledWith(expect.objectContaining({ record: expect.objectContaining({ ...draft,
    shop: { id: mockShop.id, displayName: mockShop.name },
  }) }));
  await view.unmount();
  expect(addProductPhotoSources.has(mockPhotoSource)).toBe(false);
});


test('takes a photo from Add, keeps typed fields and retains it if a replacement is cancelled', async () => {
  const asset = { uri: 'file:///captured.jpg', width: 800, height: 600, mimeType: 'image/jpeg' };
  mockTakePhoto.mockResolvedValueOnce(asset).mockResolvedValueOnce(undefined);
  await render(<AddProductScreen />);
  await enterPrice();
  await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Take another photo' }));
  expect(mockTakePhoto).toHaveBeenCalledTimes(2);
  expect(mockChoosePhoto).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Sample tea');
  expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('2.35');
  expect(mockStage).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Add as new product' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm current price' }));
  expect(mockStage).toHaveBeenCalledWith(expect.objectContaining({
    record: expect.objectContaining({ original: asset, selected: asset }),
  }));
});
