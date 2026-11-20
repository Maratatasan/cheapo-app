import { fireEvent, render, screen } from '@testing-library/react-native';
import type { PriceObservationDetail } from '@cheapo/domain/price-history';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ShopRepositoryProvider } from '../component/shop/shop-repository-provider';
import type { ShopRepository } from '../data/shop-repository';
import SavedProducts, { SavedProductsScreen } from '../app/saved-products';
import SavedComparison from '../app/compare/[id]';
import { emptyReview, loadSavedPriceRecords, type LocalPhotoDraft, type ManualPriceRecord } from '../data/local-photo';
import { openCheapoSavedPriceReads } from '../data/cheapo-shopping-read-device';
import type { PendingHistoryChange } from '../data/saved-price-history';

const mockPush = jest.fn();
let mockFocusRevision = 0;
const shopRepository = {
  loadSavedShops: jest.fn(),
  saveShop: jest.fn(),
  selectShop: jest.fn(),
  updateShop: jest.fn(),
  removeShop: jest.fn(),
} satisfies ShopRepository;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ id: 'rice' }),
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback, mockFocusRevision]),
}));

jest.mock('expo-file-system', () => ({}));
jest.mock('../data/cheapo-shopping-read-device', () => ({ openCheapoSavedPriceReads: jest.fn() }));
jest.mock('../data/local-photo', () => ({
  ...jest.requireActual('../data/local-photo'),
  loadSavedPriceRecords: jest.fn(),
}));

const original = { uri: 'file:///original.jpg', width: 1000, height: 500, mimeType: 'image/jpeg' } as const;
const selected = { ...original, uri: 'file:///crop.jpg' };
const complete: LocalPhotoDraft = {
  id: 'rice',
  capturedAt: '2026-11-12T12:00:00Z',
  original,
  selected,
  shop: { id: 'lidl-1', displayName: 'Tandem Centre Lidl' },
  review: { ...emptyReview('Tandem Centre Lidl'), productName: 'Basmati rice', price: '1.25', productType: 'Dry rice', variety: 'Basmati', brand: 'Example brand' },
};

const owner = { origin: 'https://cheapo.example', householdId: '93b93988-a027-483e-8c4d-ed58a163fbfa', shopperId: 'd002d3a7-2744-4414-8336-afc644ec6878' };
const shared: PriceObservationDetail = {
  id: 'fa91641f-d265-4a3b-9695-4ff553ab5138', sourceId: 'rice', ownedByCurrentShopper: true, version: 2,
  capturedAt: '2026-11-12T12:00:00.000000Z', productId: 'rice-product', sourceProductId: null,
  productName: 'Original shared rice', shopId: 'shared-shop', sourceShopId: null, shopDisplayName: 'Shared branch',
  priceAmount: '2.10', currency: 'GBP', review: { productType: 'Dry rice' }, unitPrice: { amount: 0.21, unit: '100g' },
  cropBox: null, photos: [{ role: 'original', width: 1000, height: 500 }, { role: 'crop', width: 400, height: 300 }], selectedPhotoRole: 'crop',
};
const peer = { ...shared, id: '5353588d-923b-4f09-903d-f72adeaded5a', ownedByCurrentShopper: false, productName: 'Peer rice' };
const lastSyncedAt = '2026-11-12T13:00:00Z';
const safeArea = { frame: { x: 0, y: 0, width: 425, height: 680 }, insets: { top: 0, left: 0, bottom: 0, right: 0 } };
const cached = <T,>(value: T) => ({ status: 'cached' as const, value, lastSyncedAt });

test('opens shared history and only the selected photo, applying the current owner’s pending correction', async () => {
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([complete]);
  const queue = { owner, read: jest.fn().mockResolvedValue({ entries: [], recovery: [] }) };
  const correction: PendingHistoryChange = { resourceId: shared.id, state: 'waiting', change: { action: 'correct',
    review: { productName: 'Corrected shared rice', price: '3.40', currency: 'GBP', productType: 'Dry rice' } } };
  const session = {
    assertCurrent: jest.fn(),
    loadPriceHistory: jest.fn().mockResolvedValueOnce(cached({ observations: [shared], nextCursor: 'next-page' }))
      .mockResolvedValueOnce(cached({ observations: [peer], nextCursor: null })),
    loadPriceObservation: jest.fn().mockResolvedValue(cached({ observation: shared })),
    loadPhoto: jest.fn().mockResolvedValue(cached({ uri: 'file:///cache/verified.jpg' })),
  };
  jest.mocked(openCheapoSavedPriceReads).mockResolvedValue(session);
  await render(<SafeAreaProvider initialMetrics={safeArea}><SavedProductsScreen priceQueue={queue}
    loadPriceChanges={async () => [correction]} /></SafeAreaProvider>);

  const card = await screen.findByRole('button', { name: 'Open Corrected shared rice' });
  expect(screen.getByText('Showing saved shared prices')).toBeOnTheScreen();
  expect(session.loadPhoto).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Load more saved prices' }));
  expect(await screen.findByRole('button', { name: 'Open Peer rice' })).toBeOnTheScreen();
  await fireEvent.press(card);
  expect(await screen.findByLabelText('Cropped price photo')).toBeOnTheScreen();
  expect(screen.getByText('£3.40')).toBeOnTheScreen();
  expect(screen.getByText('Saved on this phone · Waiting to sync')).toBeOnTheScreen();
  expect(session.loadPriceObservation).toHaveBeenCalledWith(shared.id, expect.anything());
  expect(session.loadPhoto).toHaveBeenCalledTimes(1);
  expect(session.loadPhoto).toHaveBeenCalledWith(shared.id, 'crop', expect.anything());
  await fireEvent.press(screen.getByRole('button', { name: 'Original' }));
  expect(await screen.findByLabelText('Original price photo')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Open this phone’s copy' }));
  expect(await screen.findByRole('button', { name: 'Edit Basmati rice' })).toBeOnTheScreen();
  expect(screen.getByLabelText('Saved photo')).toHaveProp('source', { uri: selected.uri });
});

test('keeps the local list when a former owner’s shared detail resolves after the provider is cleared', async () => {
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([complete]);
  const queue = { owner, read: jest.fn().mockResolvedValue({ entries: [], recovery: [] }) };
  let completeRead!: (value: ReturnType<typeof cached<{ observation: PriceObservationDetail }>>) => void;
  const session = {
    assertCurrent: jest.fn(), loadPriceHistory: jest.fn().mockResolvedValue(cached({ observations: [peer], nextCursor: null })),
    loadPriceObservation: jest.fn().mockImplementation(() => new Promise(resolve => { completeRead = resolve; })), loadPhoto: jest.fn(),
  };
  jest.mocked(openCheapoSavedPriceReads).mockResolvedValue(session);
  await render(<SafeAreaProvider initialMetrics={safeArea}><SavedProductsScreen priceQueue={queue} /></SafeAreaProvider>);
  await fireEvent.press(await screen.findByRole('button', { name: 'Open Peer rice' }));
  expect(await screen.findByText('Loading saved price…')).toBeOnTheScreen();
  await screen.rerender(<SafeAreaProvider initialMetrics={safeArea}><SavedProductsScreen /></SafeAreaProvider>);
  completeRead(cached({ observation: peer }));
  expect(await screen.findByRole('button', { name: 'Open Basmati rice' })).toBeOnTheScreen();
  expect(screen.queryByText('Peer rice')).not.toBeOnTheScreen();
  expect(session.loadPhoto).not.toHaveBeenCalled();
});

test('reopens a saved product with its shop, price, and original photo', async () => {
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([complete]);
  await render(<ShopRepositoryProvider repository={shopRepository}><SavedProducts /></ShopRepositoryProvider>);

  await fireEvent.press(await screen.findByRole('button', { name: 'Open Basmati rice' }));
  expect(screen.getByText('Tandem Centre Lidl')).toBeOnTheScreen();
  expect(screen.getByText('Type: Dry rice · Variety: Basmati · Brand: Example brand')).toBeOnTheScreen();
  expect(screen.getByText('£1.25')).toBeOnTheScreen();
  expect(screen.getByLabelText('Saved photo')).toHaveProp('source', { uri: selected.uri });
  await fireEvent.press(screen.getByRole('button', { name: 'View original' }));
  expect(screen.getByLabelText('Saved photo')).toHaveProp('source', { uri: original.uri });
  await fireEvent.press(screen.getByRole('button', { name: 'Compare saved prices' }));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/compare/[id]', params: { id: 'rice' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Edit Basmati rice' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/edit-price/[id]', params: { id: 'rice' } });
});

test('shows an unfinished older photo as a draft with its original free-text shop', async () => {
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([{
    ...complete,
    shop: undefined,
    review: emptyReview('Previous shop'),
  }]);
  await render(<ShopRepositoryProvider repository={shopRepository}><SavedProducts /></ShopRepositoryProvider>);

  expect(await screen.findByRole('button', { name: 'Open Photo draft' })).toBeOnTheScreen();
  expect(screen.getByText('Previous shop')).toBeOnTheScreen();
  expect(screen.queryByText('£1.25')).not.toBeOnTheScreen();
});

test('opens a manual price and retains its edit and comparison actions without photo controls', async () => {
  const manual: ManualPriceRecord = { id: 'manual-rice', capturedAt: complete.capturedAt,
    productId: 'product-rice', shop: complete.shop!, review: complete.review! };
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([manual]);
  await render(<ShopRepositoryProvider repository={shopRepository}><SavedProducts /></ShopRepositoryProvider>);
  await fireEvent.press(await screen.findByRole('button', { name: 'Open Basmati rice' }));

  expect(screen.getByText('£1.25')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Saved photo')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'View original' })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Compare saved prices' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/compare/[id]', params: { id: manual.id } });
  await fireEvent.press(screen.getByRole('button', { name: 'Edit Basmati rice' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/edit-price/[id]', params: { id: manual.id } });
});


test('compares completed saved reviews and toggles variety and brand independently', async () => {
  const reference = { ...complete, review: { ...complete.review!, unitPrice: '0.25', unit: '100g' } };
  const offer = (id: string, displayName: string, fields: Partial<NonNullable<LocalPhotoDraft['review']>>) => ({
    ...reference, id, shop: { id, displayName }, review: { ...reference.review, ...fields },
  });
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([
    reference,
    offer('long-grain', 'Long Grain Shop', { productName: 'Long grain rice', variety: 'Long grain', unitPrice: '2', unit: 'kg' }),
    offer('other-brand', 'Other Brand Shop', { productName: 'Other-brand basmati rice', brand: 'Other brand', unitPrice: '0.15' }),
    offer('both', 'Both Match Shop', { productName: 'Example basmati 1kg', unitPrice: '3', unit: 'kg' }),
    offer('ready', 'Microwave Rice Shop', { productType: 'Microwave rice' }),
    offer('incomplete', 'Incomplete Shop', { price: '' }),
  ]);
  await render(<SavedComparison />);

  expect(await screen.findByRole('header', { name: 'Compare shop prices' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Scan product barcode' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/scan', params: { mode: 'barcode' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Scan label' }));
  expect(mockPush).toHaveBeenLastCalledWith('/scan');
  expect(screen.getByText('£2.50 / kg')).toBeOnTheScreen();
  expect(screen.getByText('Saved prices · Check when each price was recorded.')).toBeOnTheScreen();
  expect(screen.getAllByText('Recorded 12 Nov 2026')).toHaveLength(4);
  expect(screen.getAllByText(/Shop$/).map(label => label.props.children)).toEqual(['Other Brand Shop', 'Long Grain Shop', 'Both Match Shop']);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Same variety' }));
  expect(screen.getByRole('checkbox', { name: 'Same variety' })).toBeChecked();
  expect(screen.queryByText('Long Grain Shop')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Same brand' }));
  expect(screen.queryByText('Other Brand Shop')).not.toBeOnTheScreen();
  expect(screen.getByText('Both Match Shop')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Same variety' }));
  expect(screen.getByText('Long Grain Shop')).toBeOnTheScreen();
  expect(screen.queryByText('Other Brand Shop')).not.toBeOnTheScreen();
});


test('returns to the comparison with its filter and reranks the edited saved record', async () => {
  const reference = { ...complete, review: { ...complete.review!, unitPrice: '3.00', unit: 'kg' } };
  const offer = (id: string, name: string, unitPrice: string) => ({
    ...reference, id, review: { ...reference.review, productName: name, unitPrice },
  });
  const first = offer('offer-1', 'First saved offer', '1.00');
  const edited = offer('offer-2', 'Edited saved offer', '2.00');
  jest.mocked(loadSavedPriceRecords).mockResolvedValue([reference, first, edited]);
  await render(<SavedComparison />);
  await fireEvent.press(await screen.findByRole('checkbox', { name: 'Same variety' }));
  await fireEvent.press(screen.getByRole('button', { name: /^Edit Edited saved offer at/ }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/edit-price/[id]', params: { id: 'offer-2' } });
  expect(screen.getAllByText(/saved offer$/).map(label => label.props.children)).toEqual(['First saved offer', 'Edited saved offer']);

  jest.mocked(loadSavedPriceRecords).mockResolvedValue([reference, first, offer('offer-2', 'Edited saved offer', '0.90')]);
  mockFocusRevision++;
  await screen.rerender(<SavedComparison />);
  expect(await screen.findByText('£0.90 / kg')).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: 'Same variety' })).toBeChecked();
  expect(screen.getAllByText(/saved offer$/).map(label => label.props.children)).toEqual(['Edited saved offer', 'First saved offer']);
});
