import { fireEvent, render, screen } from '@testing-library/react-native';

import ProductPriceDraftScreen from '@/app/product-price-draft/[id]';
import { emptyReview } from '@/data/photo-review';
import type { ProductPriceDraft } from '@/data/price-append-queue';

const mockPendingDrafts = jest.fn();
const mockConfirm = jest.fn();
const mockRetry = jest.fn();
const mockBack = jest.fn();
const mockFindByBarcode = jest.fn();
const mockFindCandidates = jest.fn();
const mockShopping = { owner: { origin: 'https://cheapo.example', householdId: 'home', shopperId: 'phone' },
  productPrices: { pendingDrafts: mockPendingDrafts, confirm: mockConfirm }, retry: mockRetry };
const mockLookup = { findByBarcode: mockFindByBarcode, findCandidates: mockFindCandidates };
const barcode = '00036000291452';
const photo = { uri: 'file:///original.jpg', width: 800, height: 600, mimeType: 'image/jpeg' as const };
const draft: ProductPriceDraft = { catalogOperationId: 'op-oats', createdAt: '2026-11-20T15:00:00.000Z', barcode,
  record: { id: 'draft-oats', capturedAt: '2026-11-20T14:03:00.000Z', productId: 'proposed-oats',
    original: photo, selected: { ...photo, uri: 'file:///selected.jpg' }, shop: { id: 'market', displayName: 'Sample Market' },
    review: { ...emptyReview('Sample Market'), productName: 'Draft oats', productType: 'Oats', price: '1.20' } } };

jest.mock('expo-router', () => ({
  Redirect: () => null, Stack: { Screen: () => null }, useLocalSearchParams: () => ({ id: 'draft-oats' }),
  useRouter: () => ({ back: mockBack, push: jest.fn() }), useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('@/component/cheapo-shopping-provider', () => ({ useCheapoShopping: () => mockShopping }));
jest.mock('@/hooks/use-add-product-lookup', () => ({ useAddProductLookup: () => mockLookup }));

beforeEach(() => {
  jest.resetAllMocks();
  mockPendingDrafts.mockResolvedValue([draft]);
  mockConfirm.mockResolvedValue(draft.record);
  mockRetry.mockResolvedValue(undefined);
  mockFindCandidates.mockResolvedValue({ candidates: [], truncated: false });
});

test('reopens protected evidence and waits until the shopper confirms reuse of the exact product', async () => {
  mockFindByBarcode.mockResolvedValue({ id: 'canonical-oats', name: 'Market Oats', barcode, comparableGroupId: 'oats' });
  await render(<ProductPriceDraftScreen />);
  const reuse = await screen.findByRole('button', { name: 'Reuse Market Oats' });
  expect(screen.getByText('Reviewed price £1.20')).toBeOnTheScreen();
  expect(screen.getByLabelText('Reviewed price photo')).toHaveProp('source', { uri: 'file:///selected.jpg' });
  await fireEvent.press(screen.getByRole('button', { name: 'View original' }));
  expect(screen.getByLabelText('Original price photo')).toHaveProp('source', { uri: 'file:///original.jpg' });
  expect(mockConfirm).not.toHaveBeenCalled();
  await fireEvent.press(reuse);
  expect(mockConfirm).toHaveBeenCalledWith(draft.record.id, { kind: 'reuse', productId: 'canonical-oats' });
  expect(mockRetry).toHaveBeenCalledTimes(1);
  expect(mockBack).toHaveBeenCalledTimes(1);
});

test('keeps an unavailable draft intact and makes checked new product creation explicit', async () => {
  mockFindByBarcode.mockRejectedValueOnce(Error('Offline')).mockResolvedValue(undefined);
  await render(<ProductPriceDraftScreen />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/Catalog unavailable/);
  expect(screen.queryByRole('button', { name: 'Add product' })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry product check' }));
  expect(await screen.findByText('No matching products found')).toBeOnTheScreen();
  expect(mockConfirm).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Add product' }));
  expect(mockConfirm).toHaveBeenCalledWith(draft.record.id, { kind: 'add' });
});
