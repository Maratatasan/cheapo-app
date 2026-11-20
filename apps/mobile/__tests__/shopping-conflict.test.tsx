import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ConflictRoute from '@/app/shopping-conflict';
import { shoppingConflictPreview } from '@/data/shopping-conflict';
import type { QueuedShoppingMutation } from '@/data/shopping-mutation-queue';

const mockRead = jest.fn();
const mockLater = jest.fn();
const mockResolve = jest.fn();
const mockReuse = jest.fn();
const mockFindMatch = jest.fn();
const mockRetry = jest.fn();
const mockDismiss = jest.fn();
const mockOwner = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: () => null, Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'price-edit' }),
  useRouter: () => ({ dismissTo: mockDismiss }),
  useFocusEffect: (effect: () => void) => jest.requireActual('react').useEffect(effect, [effect]),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'replacement-edit' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@/data/cheapo-shopping-read-device', () => ({ createOwnerShoppingReads: () => ({ findEditableProductByBarcode: mockFindMatch }) }));
jest.mock('@/component/cheapo-shopping-provider', () => ({ useCheapoShopping: () => ({
  owner: { origin: 'https://shopping.example', householdId: 'owner-home', shopperId: 'owner-phone' },
  assertOwner: mockOwner, mutationQueue: { read: mockRead, laterEdits: mockLater }, resolveConflict: mockResolve, useExistingProduct: mockReuse, retry: mockRetry,
}) }));

const resourceId = '79ff1365-8c9d-4995-9810-9047d3539525';
const capturedAt = '2026-11-12T12:00:00.000000Z';
const entry: QueuedShoppingMutation = {
  intent: { operationId: 'price-edit', createdAt: capturedAt, title: 'Brown rice', waitFor: [], action: {
    kind: 'price', priceKey: resourceId, base: { kind: 'version', version: 1, id: resourceId }, change: {
      action: 'correct', review: { productName: 'Brown rice', packSize: '500 g', brand: 'Example Foods', price: '2.25', currency: 'GBP' },
      unitPrice: { amount: 4.5, unit: 'kg' },
    },
  } },
  outcome: { kind: 'conflict', currentVersion: 2, current: { id: resourceId, version: 2, capturedAt, shopId: 'shop-1',
    sourceId: 'price-original', ownedByCurrentShopper: false, shopDisplayName: 'Example shop', sourceShopId: null,
    productId: null, sourceProductId: null, productName: 'Brown rice', priceAmount: '2.75', currency: 'GBP',
    unitPrice: { amount: 5.5, unit: 'kg' }, review: { packSize: '500 g', brand: 'Orchard Foods' },
    cropBox: null, selectedPhotoRole: null, photos: [],
  } },
};

beforeEach(() => {
  jest.resetAllMocks();
  mockRead.mockResolvedValue({ entries: [entry], recovery: [] });
  mockLater.mockResolvedValue([{ id: 'later-edit', title: 'Fix unit price' }]);
  mockResolve.mockResolvedValue(undefined);
  mockRetry.mockResolvedValue({ state: 'complete', items: [] });
});

it('shows reviewed fields and confirms the specifically named later edits before keeping cloud', async () => {
  await render(<ConflictRoute />);
  expect(await screen.findByRole('header', { name: 'On this phone' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'In the cloud' })).toBeOnTheScreen();
  for (const label of ['2.25', '2.75', 'Example Foods', 'Orchard Foods', '4.5 / kg', '5.5 / kg']) {
    expect(screen.getByText(label)).toBeOnTheScreen();
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Keep cloud' }));
  expect(screen.getByText('1 later edit will also be set aside and kept for recovery.')).toBeOnTheScreen();
  expect(screen.getByText('Fix unit price')).toBeOnTheScreen();
  expect(mockResolve).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to versions' }));
  expect(screen.getByRole('header', { name: 'In the cloud' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Keep cloud' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm keep cloud' }));
  expect(mockResolve).toHaveBeenCalledWith('price-edit', { kind: 'keep-cloud', laterIds: ['later-edit'] });
  expect(mockRetry).toHaveBeenCalledTimes(1);
  expect(mockDismiss).toHaveBeenCalledWith('/pending-sync');
});

it('commits a single keep-phone choice before returning to the queue or requesting sync', async () => {
  let release = () => {};
  mockResolve.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
  await render(<ConflictRoute />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Keep phone' }));
  expect(screen.getByRole('button', { name: 'Keep phone' })).toBeDisabled();
  expect(mockResolve).toHaveBeenCalledTimes(1);
  expect(mockResolve).toHaveBeenCalledWith('price-edit', {
    kind: 'keep-phone', replacementId: 'replacement-edit', createdAt: expect.any(String),
  });
  expect(mockRetry).not.toHaveBeenCalled();
  expect(mockDismiss).not.toHaveBeenCalled();
  await act(async () => { release(); });
  expect(mockRetry).toHaveBeenCalledTimes(1);
  expect(mockDismiss).toHaveBeenCalledWith('/pending-sync');
});

it('keeps explicit blank shop fields separate from unchanged ones', () => {
  const shop: QueuedShoppingMutation = { ...entry, intent: { ...entry.intent, action: {
    kind: 'edit-shop', shopId: 'shop-1', base: { kind: 'version', version: '1:fa91641f-d265-4a3b-9695-4ff553ab5138' },
    details: { nickname: null, address: '18 Orchard Street' },
  } }, outcome: { kind: 'conflict', currentVersion: '2:fa91641f-d265-4a3b-9695-4ff553ab5138',
    current: { id: 'shop-1', name: 'Example Market', nickname: 'Weekly shop', address: '10 Fruit Street' } } };
  expect(shoppingConflictPreview(shop, [])?.phone).toEqual([
    { label: 'Shop name', value: 'Unchanged' }, { label: 'Nickname', value: 'Blank' }, { label: 'Address', value: '18 Orchard Street' },
  ]);
});

it('asks to reuse a verified product and lets the shopper retry when the exact match cannot be verified', async () => {
  const barcode = '00036000291452';
  const product = { id: 'existing-rice', name: 'Shared brown rice', productType: 'Brown rice', barcode };
  const draft: QueuedShoppingMutation = {
    intent: { ...entry.intent, title: 'Save brown rice', action: { kind: 'create-product', product: { ...product, id: 'proposed-rice' } } },
    outcome: { kind: 'product-match', product },
  };
  mockRead.mockResolvedValue({ entries: [draft], recovery: [] });
  mockLater.mockResolvedValue([]);
  mockFindMatch.mockResolvedValueOnce({ status: 'unavailable' })
    .mockResolvedValueOnce({ status: 'fresh', value: { product, version: 2 } });

  await render(<ConflictRoute />);
  expect(await screen.findByRole('header', { name: 'Product already exists' })).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'Existing product' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Keep phone' })).not.toBeOnTheScreen();
  expect(mockReuse).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Reuse product' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Saved price and photos are still here/i);
  expect(mockReuse).not.toHaveBeenCalled();
  expect(mockRetry).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Reuse product' }));
  expect(mockFindMatch).toHaveBeenLastCalledWith(barcode, expect.any(AbortSignal));
  expect(mockReuse).toHaveBeenCalledWith('price-edit', product.id);
  expect(mockRetry).toHaveBeenCalledTimes(1);
  expect(mockDismiss).toHaveBeenCalledWith('/pending-sync');
});
