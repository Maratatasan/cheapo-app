import { fireEvent, render, screen } from '@testing-library/react-native';
import EditSavedPrice from '@/app/edit-price/[id]';
import { loadSavedPriceRecord, saveLocalPhotoReview, type LocalPhotoDraft } from '@/data/local-photo';
import { emptyReview } from '@/data/photo-review';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'capture-1' }),
  useRouter: () => ({ canGoBack: () => true, back: mockBack }),
}));
jest.mock('expo-file-system', () => ({}));
jest.mock('../data/local-photo', () => ({ loadSavedPriceRecord: jest.fn(), saveLocalPhotoReview: jest.fn() }));

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
  jest.clearAllMocks();
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
