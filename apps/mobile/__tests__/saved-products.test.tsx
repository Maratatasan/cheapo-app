import { fireEvent, render, screen } from '@testing-library/react-native';
import SavedProducts from '../app/saved-products';
import { emptyReview, loadLocalPhotos, type LocalPhotoDraft } from '../data/local-photo';

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
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
