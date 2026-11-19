import { act, fireEvent, render, screen } from '@testing-library/react-native';
import EditSavedPrice from '@/app/edit-price/[id]';
import { linkSavedPriceToBarcode, loadSavedPriceRecord, saveLocalPhotoReview, type LocalPhotoDraft } from '@/data/local-photo';
import { findLocalProductByBarcode, findLocalProductById } from '@/data/local-products';
import { emptyReview } from '@/data/photo-review';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  usePreventRemove: jest.fn(),
  useLocalSearchParams: () => ({ id: 'capture-1' }),
  useRouter: () => ({ canGoBack: () => true, back: mockBack }),
}));
jest.mock('expo-file-system', () => ({}));
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
  jest.mocked(loadSavedPriceRecord).mockResolvedValue(product);
  jest.mocked(saveLocalPhotoReview).mockResolvedValue(product);
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
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
  expect(await screen.findByText(catalog.name)).toBeOnTheScreen();
  expect(linkSavedPriceToBarcode).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Link this barcode' }));
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
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
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
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm barcode' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Link this barcode' }));
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel barcode link' })).toBeDisabled();
  expect(screen.getAllByRole('button', { name: 'Saving…' })).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(mockBack).not.toHaveBeenCalled();
  await act(() => { complete(result); });
  expect(await screen.findByText(catalog.barcode)).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});
