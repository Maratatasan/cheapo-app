import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AddProductPriceReview } from '@/component/add-product-price-review';
import { readPhotoText } from '@/data/photo-text';

jest.mock('@/data/photo-text', () => ({ readPhotoText: jest.fn() }));
let mockProviderEnabled = false;
jest.mock('@/lib/direct-auth/phone-session', () => ({
  get fieldPhotoAnalysisEnabled() { return mockProviderEnabled; },
  phoneAuth: { getState: () => ({ planAllowed: true, busy: false }), subscribe: jest.fn(), restore: jest.fn() },
}));

const shop = { id: 'market', displayName: 'Sample market' };
const oats = { id: 'canonical-oats', name: 'Market Rolled Oats', brand: 'Market', productType: 'Oats',
  comparableGroupId: 'oats', barcode: '00036000291452' };
const controls = { onChooseShop: jest.fn(), onCompare: jest.fn(), onCancel: jest.fn() };
const exactCode = '036000291452';

beforeEach(() => {
  mockProviderEnabled = false;
  jest.mocked(readPhotoText).mockReset().mockResolvedValue({ status: 'empty' });
});

test('shows the matching product and dated shop price, then confirms a fresh observation in one tap', async () => {
  const findByBarcode = jest.fn(async () => oats);
  const onSubmit = jest.fn(async () => 'queued' as const);
  await render(<AddProductPriceReview {...controls} shop={shop} lookup={{ findByBarcode, findCandidates: jest.fn() }}
    initialBarcode={exactCode} initialReview={{ price: '1.20' }} onSubmit={onSubmit}
    loadLatestPrice={async () => ({ price: 1.20, currency: 'GBP', capturedOn: '2026-11-16' })} />);
  expect(screen.getByRole('button', { name: 'Confirm current price' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  expect(onSubmit).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByRole('button', { name: `Use ${oats.name}` }));
  expect(await screen.findByText('Last recorded at Sample market · £1.20 · 16 Nov 2026')).toBeOnTheScreen();
  expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('1.20');
  expect(onSubmit).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm current price' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ shop, barcode: oats.barcode,
    choice: { kind: 'reuse', product: oats }, review: expect.objectContaining({ productName: oats.name, productType: 'Oats', price: '1.20' }) }));
});

test('requires a selected shop and a valid price after explicitly choosing a checked new product', async () => {
  const lookup = { findByBarcode: jest.fn(), findCandidates: jest.fn(async () => ({ candidates: [], truncated: false })) };
  const onSubmit = jest.fn(async () => 'queued' as const);
  const props = { ...controls, lookup, onSubmit, initialReview: { productName: 'Sample tea', productType: 'Tea' } };
  await render(<AddProductPriceReview {...props} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Add as new product' }));
  expect(screen.getByRole('button', { name: 'Confirm current price' })).toBeDisabled();
  await screen.rerender(<AddProductPriceReview {...props} shop={shop} />);
  expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Sample tea');
  expect(screen.getByRole('button', { name: 'Confirm current price' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Pack price'), '2.35');
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm current price' }));
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ shop, choice: { kind: 'add' },
    review: expect.objectContaining({ productName: 'Sample tea', productType: 'Tea', price: '2.35' }) }));
});

test('keeps unavailable lookup as a draft with photo and reviewed details, without any add choice', async () => {
  const action = jest.fn(async () => 'draft' as const);
  const photo = { id: 'draft-source', capturedAt: '2026-11-20T12:00:00.000Z',
    original: { uri: 'file:///original.jpg', mimeType: 'image/jpeg', width: 800, height: 600 },
    selected: { uri: 'file:///crop.jpg', mimeType: 'image/jpeg', width: 400, height: 300 } } as const;
  const lookup = { findByBarcode: jest.fn(async () => { throw Error('Offline'); }), findCandidates: jest.fn() };
  const initialReview = { productName: 'Sample tea', productType: 'Tea', price: '2.35' };
  await render(<AddProductPriceReview {...controls} shop={shop} initialBarcode={exactCode} initialReview={initialReview}
    lookup={lookup} onSubmit={action} photo={photo} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not check the catalog/);
  expect(screen.queryByRole('button', { name: 'Add as new product' })).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Confirm current price' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save draft for review' }));
  expect(action).toHaveBeenCalledWith(expect.objectContaining({ choice: undefined, photo, shop, barcode: oats.barcode,
    review: expect.objectContaining(initialReview) }));
  expect(await screen.findByText('Draft saved · Review in Pending sync')).toBeOnTheScreen();
});

test('reviews an OCR price locally after choosing the exact product and discards it when the photo changes', async () => {
  const product = { ...oats, pack: { quantity: 500, unit: 'g' } };
  const asset = { uri: 'file:///chosen.jpg', width: 800, height: 600, mimeType: 'image/jpeg' } as const;
  const photo = { id: 'source', capturedAt: '2026-11-20T12:00:00Z', original: asset, selected: asset };
  const next = { ...asset, uri: 'file:///next.jpg' };
  jest.mocked(readPhotoText).mockImplementation(async uri => uri === asset.uri ? { status: 'found', evidence: {
    width: 800, height: 600, blocks: [{ lines: [
      { text: 'Market Rolled Oats 500 g', box: [0.1, 0.1, 0.45, 0.14], elements: [] },
      { text: '£2.50', box: [0.1, 0.17, 0.25, 0.22], elements: [] },
    ] }],
  } } : { status: 'empty' });
  const onSubmit = jest.fn(async () => 'queued' as const);
  const props = { ...controls, shop, initialBarcode: exactCode, onSubmit,
    lookup: { findByBarcode: jest.fn(async () => product), findCandidates: jest.fn() } };
  await render(<AddProductPriceReview {...props} photo={photo} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Check product' }));
  expect(jest.mocked(readPhotoText)).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByRole('button', { name: `Use ${oats.name}` }));
  await waitFor(() => expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('2.50'));
  expect(onSubmit).not.toHaveBeenCalled();

  await screen.rerender(<AddProductPriceReview {...props} photo={{ ...photo, original: next, selected: next }} />);
  expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('');
  expect(screen.getByRole('button', { name: 'Confirm current price' })).toBeDisabled();
  await screen.rerender(<AddProductPriceReview {...props} photo={photo} />);
  await waitFor(() => expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('2.50'));
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm current price' }));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ photo, shop, choice: { kind: 'reuse', product },
    review: expect.objectContaining({ price: '2.50', currency: 'GBP' }),
  }));
});

test('keeps packaging analysis optional and available to identify a photo without a price', async () => {
  mockProviderEnabled = true;
  const asset = { uri: 'file:///package.jpg', width: 400, height: 300, mimeType: 'image/jpeg' } as const;
  const lookup = { findByBarcode: jest.fn(), findCandidates: jest.fn() };
  const onSubmit = jest.fn();
  await render(<AddProductPriceReview {...controls} shop={shop} lookup={lookup} onSubmit={onSubmit}
    photo={{ id: 'source', capturedAt: '2026-11-20T12:00:00Z', original: asset, selected: asset }} />);
  expect(screen.getByRole('button', { name: 'Analyse packaging photo' })).toBeEnabled();
  expect(screen.getByLabelText('Pack price')).toHaveDisplayValue('');
  expect(lookup.findCandidates).not.toHaveBeenCalled();
  expect(onSubmit).not.toHaveBeenCalled();
});
