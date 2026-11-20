import { act, fireEvent, render, screen } from '@testing-library/react-native';

import PendingSyncRoute from '@/app/pending-sync';
import type { PendingShoppingChange } from '@/data/shopping-sync-runtime';

const mockReadPending = jest.fn();
const mockRetry = jest.fn();
const mockConfirmShop = jest.fn();
const mockDismiss = jest.fn();
const mockPush = jest.fn();
const mockSubscribe = jest.fn();
const mockPendingDrafts = jest.fn();
const mockFindByBarcode = jest.fn();
const mockLookup = { findByBarcode: mockFindByBarcode, findCandidates: jest.fn() };
const held: PendingShoppingChange = { id: 'price:rice', sourceId: 'rice', title: 'Brown rice', state: 'needs-shop' };
const mockShopping = {
  owner: { origin: 'https://shopping.example', householdId: 'owner-home', shopperId: 'owner-phone' },
  readPending: mockReadPending, retry: mockRetry, confirmPriceShop: mockConfirmShop, subscribeSync: mockSubscribe,
  productPrices: { pendingDrafts: mockPendingDrafts },
};

jest.mock('expo-router', () => ({
  Redirect: () => null, Stack: { Screen: () => null }, usePreventRemove: jest.fn(),
  useRouter: () => ({ dismissTo: mockDismiss, push: mockPush }),
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@/component/cheapo-shopping-provider', () => ({ useCheapoShopping: () => mockShopping }));
jest.mock('@/hooks/use-add-product-lookup', () => ({ useAddProductLookup: () => mockLookup }));
jest.mock('@/hooks/use-saved-shops', () => ({ useSavedShops: () => ({
  shops: { shops: [{ id: 'shop-42', name: 'Example Market', nickname: 'Weekly shop' }],
    currentShop: { id: 'different-shop', name: 'Default store' } },
}) }));

beforeEach(() => {
  jest.resetAllMocks();
  mockConfirmShop.mockResolvedValue(undefined);
  mockSubscribe.mockReturnValue(() => {});
  mockReadPending.mockResolvedValue([held]);
  mockPendingDrafts.mockResolvedValue([]);
  mockRetry.mockResolvedValue({ state: 'complete', items: [] });
});

it('updates the visible queue when an automatic sync finishes', async () => {
  mockReadPending.mockResolvedValue([{ id: 'price:rice', sourceId: 'rice', title: 'Brown rice', state: 'waiting' }]);
  await render(<PendingSyncRoute />);
  expect(await screen.findByText('Saved on this phone · Waiting to sync')).toBeOnTheScreen();
  await act(() => { mockSubscribe.mock.calls.forEach(([listener]) => listener({ state: 'complete', items: [] })); });
  expect(screen.getByText('No changes waiting to sync.')).toBeOnTheScreen();
  expect(mockRetry).not.toHaveBeenCalled();
});

it('rechecks an offline draft after sync reconnects and keeps a found product for explicit review', async () => {
  const barcode = '00036000291452';
  mockReadPending.mockResolvedValue([]);
  mockPendingDrafts.mockResolvedValue([{ barcode, record: { id: 'draft-oats', review: { productName: 'Sample oats' } } }]);
  mockFindByBarcode.mockRejectedValueOnce(Error('Offline')).mockResolvedValue({ id: 'oats', name: 'Market oats', barcode });
  await render(<PendingSyncRoute />);
  expect(await screen.findByText('Catalog unavailable · Needs review')).toBeOnTheScreen();
  await act(async () => { mockSubscribe.mock.calls.forEach(([listener]) => listener({ state: 'complete', items: [] })); });
  expect(await screen.findByText('Product already exists · Needs review')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Review product draft for Sample oats' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/product-price-draft/[id]', params: { id: 'draft-oats' } });
  expect(mockLookup.findCandidates).not.toHaveBeenCalled();
  expect(mockRetry).not.toHaveBeenCalled();
});

it('confirms the exact held price and branch locally before requesting sync', async () => {
  let release = () => {};
  mockConfirmShop.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
  mockReadPending.mockResolvedValueOnce([held]).mockResolvedValue([]);
  await render(<PendingSyncRoute />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Choose shop for Brown rice' }));
  expect(screen.getByRole('header', { name: 'Choose shop for saved price' })).toBeOnTheScreen();
  expect(screen.queryByText('Current shop')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Weekly shop Example Market' }));
  expect(mockConfirmShop).toHaveBeenCalledWith('rice', { id: 'shop-42', displayName: 'Weekly shop' });
  expect(mockRetry).not.toHaveBeenCalled();
  await act(async () => { release(); });
  expect(await screen.findByText('No changes waiting to sync.')).toBeOnTheScreen();
  expect(mockRetry).toHaveBeenCalledTimes(1);
});

it('retries actual actionable work and keeps recovery visible without offering to resend it', async () => {
  const recovery = { id: 'recovery:example', sourceId: 'example', title: 'Saved soup', state: 'recovery' };
  mockReadPending.mockResolvedValue([{ id: 'photo:rice', sourceId: 'rice', title: 'Brown rice', state: 'photo-failed' }, recovery]);
  mockRetry.mockResolvedValue({ state: 'pending', items: [recovery] });
  await render(<PendingSyncRoute />);
  expect(await screen.findByText('Price synced · Could not sync the photo')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry sync' }));
  expect(mockRetry).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Held for recovery · Included in protected shopping data')).toBeOnTheScreen();
  expect(screen.queryByText('Brown rice')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry sync' })).toBeDisabled();
});

it('leaves a failed shop confirmation selectable and keeps the original held price', async () => {
  mockConfirmShop.mockRejectedValue(Error('Publication interrupted'));
  await render(<PendingSyncRoute />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Choose shop for Brown rice' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Weekly shop Example Market' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm this shop. The price is still on this phone.');
  expect(mockRetry).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('button', { name: 'Choose shop for Brown rice' })).toBeOnTheScreen();
});

it('opens a product match as a review instead of automatically retrying the duplicate', async () => {
  mockReadPending.mockResolvedValue([{ id: 'mutation:product', operationId: 'proposed-product',
    title: 'Saved brown rice', state: 'needs-product-review' }]);
  await render(<PendingSyncRoute />);

  expect(await screen.findByText('Product already exists · Needs review')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Retry sync' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Review product match for Saved brown rice' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/shopping-conflict', params: { id: 'proposed-product' } });
  expect(mockRetry).not.toHaveBeenCalled();
});
