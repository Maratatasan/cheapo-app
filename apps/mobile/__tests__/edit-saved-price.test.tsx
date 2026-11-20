import { act, fireEvent, render, screen } from '@testing-library/react-native';
import EditSavedPrice from '@/app/edit-price/[id]';
import { linkSavedPriceToBarcode, loadSavedPriceRecord, saveLocalPhotoReview, type LocalPhotoDraft } from '@/data/local-photo';
import { findLocalProductByBarcode, findLocalProductById } from '@/data/local-products';
import { emptyReview } from '@/data/photo-review';

const mockBack = jest.fn();
const mockEnqueue = jest.fn();
const mockRetry = jest.fn();
const mockQueued = jest.fn();
const mockChanges = jest.fn();
const mockLoad = jest.fn();
const mockAssertOwner = jest.fn();
const mockRandomId = jest.fn();
const mockObservation = jest.fn();
const mockReadCurrent = jest.fn();
const mockRuntime = {
  owner: { origin: 'https://api.example.test', householdId: 'test-household', shopperId: 'test-shopper' },
  assertOwner: mockAssertOwner, commitMutation: mockEnqueue,
  priceQueue: { read: mockQueued }, priceRecords: { load: mockLoad },
  loadPriceChanges: mockChanges, retry: mockRetry,
};
let mockShopping: typeof mockRuntime | null;
let mockRoute: { id: string; source?: string };
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  usePreventRemove: jest.fn(),
  useLocalSearchParams: () => mockRoute,
  useRouter: () => ({ canGoBack: () => true, back: mockBack }),
}));
jest.mock('expo-file-system', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: () => mockRandomId() }));
jest.mock('../component/cheapo-shopping-provider', () => ({ useCheapoShopping: () => mockShopping }));
jest.mock('../data/cheapo-shopping-read-device', () => ({ openCheapoSavedPriceReads: async () => ({
  loadPriceObservation: mockObservation, assertCurrent: mockReadCurrent,
}) }));
jest.mock('expo-camera', () => ({ useCameraPermissions: () => [null, jest.fn()] }));
jest.mock('../data/photo-barcode', () => ({ decodePhotoBarcodes: async () => ({ status: 'found', codes: ['036000291452', '4006381333931'] }) }));
jest.mock('../data/local-products', () => ({ findLocalProductByBarcode: jest.fn(), findLocalProductById: jest.fn() }));
jest.mock('../data/local-photo', () => ({ loadSavedPriceRecord: jest.fn(), saveLocalPhotoReview: jest.fn(), linkSavedPriceToBarcode: jest.fn() }));

const photo = { uri: 'file:///label.jpg', width: 300, height: 300, mimeType: 'image/jpeg' } as const;
const review = {
  ...emptyReview('Test shop'), productName: 'Tilda Long Grain Rice 1kg', price: '1.69',
  unitPrice: '0.169', unit: '100g', productType: 'Dry rice', variety: 'Long grain', brand: 'Tilda',
};
const product: LocalPhotoDraft = {
  id: 'capture-1', capturedAt: '2026-11-12T12:00:00Z', original: photo, selected: photo, review,
  shop: { id: 'test-shop', displayName: 'Test shop' },
};

beforeEach(() => {
  jest.resetAllMocks();
  mockShopping = null;
  mockRoute = { id: 'capture-1' };
  mockEnqueue.mockResolvedValue(undefined);
  mockRandomId.mockReturnValueOnce('test-operation-1').mockReturnValue('test-operation-2');
  mockRetry.mockResolvedValue(undefined);
  mockQueued.mockResolvedValue({ entries: [], recovery: [] });
  mockChanges.mockResolvedValue([]);
  mockLoad.mockResolvedValue(product);
  jest.mocked(loadSavedPriceRecord).mockResolvedValue(product);
  jest.mocked(saveLocalPhotoReview).mockResolvedValue(product);
});

test('durably corrects the exact household record and disregards a matching local source alias from a peer', async () => {
  const id = '1f39e272-9d1a-4204-9094-fe87d761cd43';
  mockRoute = { id, source: 'shared' };
  mockShopping = mockRuntime;
  mockQueued.mockResolvedValue({ entries: [{ record: product }], recovery: [] });
  mockChanges.mockResolvedValue([{ operationId: 'local-only', state: 'waiting', sourceId: product.id,
    change: { action: 'correct', review: { ...review, price: '9.99' } } }]);
  mockObservation.mockResolvedValue({ status: 'cached', lastSyncedAt: product.capturedAt,
    value: { observation: { id, sourceId: product.id, ownedByCurrentShopper: false, version: 4,
      capturedAt: product.capturedAt, productId: null, sourceProductId: null, productName: 'Peer rice', shopId: 'test-shop',
      sourceShopId: null, shopDisplayName: 'Test shop', priceAmount: '1.690000', currency: 'GBP', review: null,
      unitPrice: null, photos: [], cropBox: null, selectedPhotoRole: null } } });
  let commit: () => void = () => {};
  mockEnqueue.mockReturnValue(new Promise<void>(resolve => { commit = resolve; }));
  await render(<EditSavedPrice />);
  expect(await screen.findByLabelText('Product name')).toHaveDisplayValue('Peer rice');
  expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('1.69');
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.10');
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockRetry).not.toHaveBeenCalled();
  expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ kind: 'price',
    priceKey: id, base: { kind: 'version', id, version: 4 }, change: { action: 'correct', unitPrice: null,
      review: expect.objectContaining({ productName: 'Peer rice', price: '2.10' }) } }) }));
  await act(async () => { commit(); });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockRetry).toHaveBeenCalledTimes(1);
  expect(saveLocalPhotoReview).not.toHaveBeenCalled();
});

test('keeps the editor from advancing if its enrolled commit reports a changed owner', async () => {
  mockShopping = mockRuntime;
  mockQueued.mockResolvedValue({ entries: [{ record: product }], recovery: [] });
  mockEnqueue.mockRejectedValue(Error('Cheapo access changed.'));
  await render(<EditSavedPrice />);
  await fireEvent.changeText(await screen.findByLabelText('Pack price'), '2.25');
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toBeOnTheScreen();
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockRetry).not.toHaveBeenCalled();
  expect(saveLocalPhotoReview).not.toHaveBeenCalled();
});

test('requires a reason, keeps the saved photo available and durably queues ordered mark and undo changes', async () => {
  mockShopping = mockRuntime;
  mockQueued.mockResolvedValue({ entries: [{ record: product }], recovery: [] });
  await render(<EditSavedPrice />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Record in error' }));
  expect(screen.getByRole('button', { name: 'Save reason' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Reason for marking this price in error'), '  Wrong shelf label  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Save reason' }));
  expect(await screen.findByText('Recorded in error')).toBeOnTheScreen();
  expect(screen.getByText('Wrong shelf label')).toBeOnTheScreen();
  expect(screen.getByLabelText('Price photo preview')).toBeOnTheScreen();
  expect(mockEnqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ operationId: 'test-operation-1',
    action: { kind: 'price', priceKey: product.id, base: { kind: 'append', sourceId: product.id },
      change: { action: 'record_in_error', reason: 'Wrong shelf label' } } }));

  await fireEvent.press(screen.getByRole('button', { name: 'Undo recorded in error' }));
  expect(await screen.findByRole('button', { name: 'Record in error' })).toBeOnTheScreen();
  expect(mockEnqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ operationId: 'test-operation-2',
    action: { kind: 'price', priceKey: product.id, base: { kind: 'operation', operationId: 'test-operation-1' },
      change: { action: 'undo_recorded_in_error' } } }));
  expect(mockRetry).toHaveBeenCalledTimes(2);
  expect(mockBack).not.toHaveBeenCalled();
  expect(saveLocalPhotoReview).not.toHaveBeenCalled();
});

test.each([false, true])('keeps a queued edit behind its dependent write (earlier correction: %s)', async earlierCorrection => {
  mockShopping = mockRuntime;
  mockQueued.mockResolvedValue({ entries: [{ record: product }], recovery: [] });
  const { shop: _shop, ...fields } = review;
  if (earlierCorrection) mockChanges.mockResolvedValue([{ operationId: 'earlier-edit', state: 'waiting', sourceId: product.id,
    change: { action: 'correct', review: { ...fields, price: '2.10' } } }]);
  await render(<EditSavedPrice />);
  expect(await screen.findByLabelText('Pack price')).toHaveDisplayValue(earlierCorrection ? '2.10' : review.price);
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.25');
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({ kind: 'price',
    priceKey: product.id, base: earlierCorrection ? { kind: 'operation', operationId: 'earlier-edit' } : { kind: 'append', sourceId: product.id },
    change: expect.objectContaining({ review: expect.objectContaining({ price: '2.25' }) }) }) }));
  expect(saveLocalPhotoReview).not.toHaveBeenCalled();
});

test('opens the original unit and amount and cancels without saving', async () => {
  await render(<EditSavedPrice />);
  expect(await screen.findByLabelText('Unit price (optional)')).toHaveDisplayValue('0.169');
  expect(screen.getByLabelText('Unit (for example kg or litre)')).toHaveDisplayValue('100g');
  expect(screen.getByLabelText('Brand')).toHaveDisplayValue('Tilda');
  expect(screen.getByLabelText('Confirmed shop: Test shop')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Unit price (optional)'), '1.69');
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(saveLocalPhotoReview).not.toHaveBeenCalled();
});

test('keeps the edited values on failure and saves to the same ID on retry', async () => {
  jest.mocked(saveLocalPhotoReview).mockRejectedValueOnce(Error('Disk full'));
  await render(<EditSavedPrice />);
  await fireEvent.changeText(await screen.findByLabelText('Unit price (optional)'), '1.69');
  await fireEvent.changeText(screen.getByLabelText('Unit (for example kg or litre)'), 'kg');
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not save changes. Your edits are still here. Try again.');
  expect(screen.getByLabelText('Unit (for example kg or litre)')).toHaveDisplayValue('kg');
  expect(mockBack).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  expect(saveLocalPhotoReview).toHaveBeenLastCalledWith('capture-1', { ...review, unitPrice: '1.69', unit: 'kg' });
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('shows an unavailable state when the selected record no longer exists', async () => {
  jest.mocked(loadSavedPriceRecord).mockResolvedValue(null);
  await render(<EditSavedPrice />);
  expect(await screen.findByText('Saved product unavailable')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeOnTheScreen();
});


test('links a chosen barcode without discarding or saving in-progress price edits', async () => {
  const catalog = { id: 'known-rice', name: 'Matched rice 1 kg', barcode: '00036000291452' };
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(catalog);
  jest.mocked(linkSavedPriceToBarcode).mockResolvedValue({ record: { ...product, productId: catalog.id }, product: catalog });
  await render(<EditSavedPrice />);
  await fireEvent.changeText(await screen.findByLabelText('Pack size'), '900 g');
  await fireEvent.press(screen.getByRole('button', { name: 'Link barcode' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel barcode link' }));
  expect(screen.getByLabelText('Pack size')).toHaveDisplayValue('900 g');

  await fireEvent.press(screen.getByRole('button', { name: 'Link barcode' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Barcode 036000291452' }));
  expect(findLocalProductByBarcode).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Check barcode' }));
  expect(await screen.findByText(catalog.name)).toBeOnTheScreen();
  expect(linkSavedPriceToBarcode).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save barcode link' }));
  expect(await screen.findByText(catalog.barcode)).toBeOnTheScreen();
  expect(linkSavedPriceToBarcode).toHaveBeenCalledWith('capture-1', catalog.barcode, { kind: 'existing', productId: catalog.id });
  expect(screen.getByLabelText('Pack size')).toHaveDisplayValue('900 g');
  expect(saveLocalPhotoReview).not.toHaveBeenCalled();
  expect(mockBack).not.toHaveBeenCalled();
});

test('previews original metadata for an unknown code and waits for explicit creation', async () => {
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(undefined);
  await render(<EditSavedPrice />);
  await fireEvent.changeText(await screen.findByLabelText('Product name'), 'Unsaved name');
  await fireEvent.press(screen.getByRole('button', { name: 'Link barcode' }));
  await fireEvent.changeText(screen.getByLabelText('Product barcode'), '036000291452');
  await fireEvent.press(screen.getByRole('button', { name: 'Check barcode' }));
  expect(await screen.findByText('New product from saved details')).toBeOnTheScreen();
  expect(screen.getByText(review.productName)).toBeOnTheScreen();
  expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Unsaved name');
  expect(linkSavedPriceToBarcode).not.toHaveBeenCalled();
  expect(saveLocalPhotoReview).not.toHaveBeenCalled();
});

test('shows a previously linked barcode read-only', async () => {
  jest.mocked(loadSavedPriceRecord).mockResolvedValue({ ...product, productId: 'known-rice' });
  jest.mocked(findLocalProductById).mockResolvedValue({ id: 'known-rice', name: review.productName, barcode: '00036000291452' });
  await render(<EditSavedPrice />);
  expect(await screen.findByText('00036000291452')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Link barcode' })).not.toBeOnTheScreen();
});


test('keeps the saved record open while a confirmed barcode link is committing', async () => {
  const catalog = { id: 'known-rice', name: 'Matched rice 1 kg', barcode: '00036000291452' };
  jest.mocked(findLocalProductByBarcode).mockResolvedValue(catalog);
  const result = { record: { ...product, productId: catalog.id }, product: catalog };
  let complete!: (value: typeof result) => void;
  jest.mocked(linkSavedPriceToBarcode).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  await render(<EditSavedPrice />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Link barcode' }));
  await fireEvent.changeText(screen.getByLabelText('Product barcode'), '036000291452');
  await fireEvent.press(screen.getByRole('button', { name: 'Check barcode' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Save barcode link' }));
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel barcode link' })).toBeDisabled();
  expect(screen.getAllByRole('button', { name: 'Saving…' })).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockBack).not.toHaveBeenCalled();
  await act(() => { complete(result); });
  expect(await screen.findByText(catalog.barcode)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});
