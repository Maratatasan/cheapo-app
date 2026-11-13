import { fireEvent, render, screen } from '@testing-library/react-native';
import SavedProducts from '../app/saved-products';
import SavedComparison from '../app/compare/[id]';
import { emptyReview, loadLocalPhotos, type LocalPhotoDraft } from '../data/local-photo';

const mockPush = jest.fn();
let mockFocusRevision = 0;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ id: 'rice' }),
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback, mockFocusRevision]),
}));

jest.mock('expo-file-system', () => ({}));
jest.mock('../data/local-photo', () => ({
  ...jest.requireActual('../data/local-photo'),
  loadLocalPhotos: jest.fn(),
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

test('reopens a saved product with its shop, price, and original photo', async () => {
  jest.mocked(loadLocalPhotos).mockResolvedValue([complete]);
  await render(<SavedProducts />);

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
  jest.mocked(loadLocalPhotos).mockResolvedValue([{
    ...complete,
    shop: undefined,
    review: emptyReview('Previous shop'),
  }]);
  await render(<SavedProducts />);

  expect(await screen.findByRole('button', { name: 'Open Photo draft' })).toBeOnTheScreen();
  expect(screen.getByText('Previous shop')).toBeOnTheScreen();
  expect(screen.queryByText('£1.25')).not.toBeOnTheScreen();
});


test('compares completed saved reviews and toggles variety and brand independently', async () => {
  const reference = { ...complete, review: { ...complete.review!, unitPrice: '0.25', unit: '100g' } };
  const offer = (id: string, displayName: string, fields: Partial<NonNullable<LocalPhotoDraft['review']>>) => ({
    ...reference, id, shop: { id, displayName }, review: { ...reference.review, ...fields },
  });
  jest.mocked(loadLocalPhotos).mockResolvedValue([
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
  jest.mocked(loadLocalPhotos).mockResolvedValue([reference, first, edited]);
  await render(<SavedComparison />);
  await fireEvent.press(await screen.findByRole('checkbox', { name: 'Same variety' }));
  await fireEvent.press(screen.getByRole('button', { name: /^Edit Edited saved offer at/ }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/edit-price/[id]', params: { id: 'offer-2' } });
  expect(screen.getAllByText(/saved offer$/).map(label => label.props.children)).toEqual(['First saved offer', 'Edited saved offer']);

  jest.mocked(loadLocalPhotos).mockResolvedValue([reference, first, offer('offer-2', 'Edited saved offer', '0.90')]);
  mockFocusRevision++;
  await screen.rerender(<SavedComparison />);
  expect(await screen.findByText('£0.90 / kg')).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: 'Same variety' })).toBeChecked();
  expect(screen.getAllByText(/saved offer$/).map(label => label.props.children)).toEqual(['Edited saved offer', 'First saved offer']);
});
