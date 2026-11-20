import { act, render, screen } from '@testing-library/react-native';

import RootLayout from '@/app/_layout';
import type { PriceQueueOwner } from '@/data/price-append-queue';

const shopperOne = { origin: 'https://shopping.example', householdId: 'household-a', shopperId: 'shopper-a' };
const shopperTwo = { ...shopperOne, shopperId: 'shopper-b' };
const mockOpen = jest.fn();
const mockSubscribe = jest.fn();
const mockWatch = jest.fn();
const mockUnsubscribe = jest.fn();
let mockEnrollmentChanged: (owner: PriceQueueOwner | null) => void;
const mockAccess = { subscribeEnrollment: mockSubscribe };

jest.mock('@/lib/cheapo-access/device', () => ({ get cheapoAccess() { return mockAccess; } }));
jest.mock('@/lib/shopping-sync-lifecycle', () => ({ watchShoppingSync: (request: () => void) => mockWatch(request) }));
jest.mock('@/data/shopping-sync-runtime', () => ({ openCheapoShopping: () => mockOpen() }));
jest.mock('@/component/shop/shop-repository-provider', () => ({ ShopRepositoryProvider: ({ children }: { children: unknown }) => children }));
jest.mock('@/hooks/use-saved-shops', () => ({ useSavedShops: jest.fn() }));
jest.mock('@/data/price-append-queue', () => ({
  sameShoppingOwner: (a: PriceQueueOwner | null, b: PriceQueueOwner) => a?.origin === b.origin
    && a.householdId === b.householdId && a.shopperId === b.shopperId,
}));
jest.mock('@/data/local-shops', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  const Stack = () => React.createElement(require('@/app/pending-sync').default);
  Stack.Screen = () => null;
  return {
    Stack, Redirect: () => null, usePreventRemove: jest.fn(),
    useRouter: () => ({ dismissTo: jest.fn() }),
    useFocusEffect: (focus: () => void) => React.useEffect(focus, [focus]),
  };
});

function runtime(owner: PriceQueueOwner, name: string) {
  return {
    owner, retry: jest.fn().mockResolvedValue({ state: 'complete', items: [] }),
    readPending: jest.fn().mockResolvedValue([{ id: 'price:sample', sourceId: 'sample', title: name, state: 'waiting' }]),
    productPrices: { pendingDrafts: jest.fn().mockResolvedValue([]) },
    subscribeSync: jest.fn(() => jest.fn()),
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockSubscribe.mockImplementation(listener => { mockEnrollmentChanged = listener; return mockUnsubscribe; });
  mockWatch.mockImplementation(request => { request(); return jest.fn(); });
});

it('mounts the actual Pending route only for the selected owner and drops the old view before a replacement loads', async () => {
  const first = runtime(shopperOne, 'First phone price');
  const second = runtime(shopperTwo, 'Second phone price');
  let finishNext = () => {};
  mockOpen.mockResolvedValueOnce(first).mockImplementationOnce(() => new Promise(resolve => { finishNext = () => resolve(second); }));
  const view = await render(<RootLayout />);
  expect(await screen.findByText('First phone price')).toBeOnTheScreen();
  expect(first.retry).toHaveBeenCalledTimes(1);
  const stopFirst = mockWatch.mock.results[0].value;
  const stopFirstReads = first.subscribeSync.mock.results.map(result => result.value);

  await act(() => mockEnrollmentChanged(shopperTwo));
  expect(screen.getByText('Opening shopping')).toBeOnTheScreen();
  expect(screen.queryByText('First phone price')).toBeNull();
  expect(stopFirst).toHaveBeenCalledTimes(1);
  expect(stopFirstReads).toHaveLength(2);
  stopFirstReads.forEach(stop => expect(stop).toHaveBeenCalledTimes(1));
  await act(() => finishNext());
  expect(await screen.findByText('Second phone price')).toBeOnTheScreen();
  expect(second.retry).toHaveBeenCalledTimes(1);

  await act(() => mockEnrollmentChanged(null));
  expect(screen.queryByText('Second phone price')).toBeNull();
  expect(mockWatch.mock.results[1].value).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

it('ignores a delayed older enrollment and reuses the same runtime when credentials rotate for the same owner', async () => {
  const old = runtime(shopperOne, 'Stale phone price');
  const selected = runtime(shopperTwo, 'Current phone price');
  const duplicate = runtime(shopperTwo, 'Duplicate runner');
  let finishOld = () => {};
  mockOpen.mockImplementationOnce(() => new Promise(resolve => { finishOld = () => resolve(old); }))
    .mockResolvedValueOnce(selected).mockResolvedValueOnce(duplicate);
  const view = await render(<RootLayout />);
  expect(screen.getByText('Opening shopping')).toBeOnTheScreen();
  await act(() => mockEnrollmentChanged(shopperTwo));
  expect(await screen.findByText('Current phone price')).toBeOnTheScreen();
  await act(() => finishOld());
  expect(screen.queryByText('Stale phone price')).toBeNull();
  expect(old.retry).not.toHaveBeenCalled();

  await act(() => mockEnrollmentChanged(shopperTwo));
  expect(screen.getByText('Current phone price')).toBeOnTheScreen();
  expect(screen.queryByText('Duplicate runner')).toBeNull();
  expect(selected.readPending).toHaveBeenCalledTimes(1);
  expect(selected.retry).toHaveBeenCalledTimes(2);
  expect(duplicate.retry).not.toHaveBeenCalled();
  await view.unmount();
});

it('opens the selected shopping route after a previously unconnected phone is enrolled', async () => {
  const first = runtime(shopperOne, 'Protected shopping work');
  mockOpen.mockResolvedValueOnce(null).mockResolvedValueOnce(first);
  await render(<RootLayout />);
  expect(screen.queryByText('Protected shopping work')).toBeNull();
  expect(mockWatch).not.toHaveBeenCalled();
  await act(() => mockEnrollmentChanged(shopperOne));
  expect(await screen.findByText('Protected shopping work')).toBeOnTheScreen();
  expect(first.retry).toHaveBeenCalledTimes(1);
});
