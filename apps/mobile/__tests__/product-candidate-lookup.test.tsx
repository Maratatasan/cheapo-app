import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { ProductCandidateLookup, type ProductCandidateLookupProps } from '@/component/product-candidate-lookup';

type Search = ProductCandidateLookupProps['findCandidates'];

const catalog = { kind: 'catalog', product: { id: 'sample-oats', name: 'Sample Rolled Oats', brand: 'Sample',
  comparableGroupId: 'rolled-oats', pack: { quantity: 500, unit: 'g' } } } as const;
const unlinked = { kind: 'unlinked_observation', observationId: 'fa91641f-d265-4a3b-9695-4ff553ab5138',
  details: { name: 'Market Rolled Oats', packSize: '500g' } } as const;

async function openSearch(props: ProductCandidateLookupProps) {
  await render(<ProductCandidateLookup {...props} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Find by packaging details' }));
  await fireEvent.changeText(screen.getByLabelText('Product name'), 'Rolled Oats');
}

test('shares reviewed criteria and waits for the shopper to select a specific candidate', async () => {
  const onCompare = jest.fn();
  const findCandidates = jest.fn(async () => ({ candidates: [catalog, unlinked], truncated: false }));
  await openSearch({ findCandidates, onCompare });
  await fireEvent.changeText(screen.getByLabelText('Pack size (optional)'), '500 g');
  await fireEvent.press(screen.getByRole('button', { name: 'Check catalog' }));

  const first = await screen.findByRole('button', { name: 'Compare Sample Rolled Oats' });
  expect(findCandidates).toHaveBeenCalledWith(expect.objectContaining({ name: 'Rolled Oats', packSize: '500 g' }),
    expect.any(AbortSignal));
  expect(onCompare).not.toHaveBeenCalled();
  expect(screen.getByText('Saved price without a linked product')).toBeOnTheScreen();
  await fireEvent.press(first);
  expect(onCompare).toHaveBeenLastCalledWith(catalog);
  await fireEvent.press(screen.getByRole('button', { name: 'Compare Market Rolled Oats' }));
  expect(onCompare).toHaveBeenLastCalledWith(unlinked);
});

test('distinguishes unavailable, limited and checked-empty results while keeping the entered name', async () => {
  const findCandidates = jest.fn<ReturnType<Search>, Parameters<Search>>()
    .mockRejectedValueOnce(Error('offline'))
    .mockResolvedValueOnce({ candidates: [], truncated: true })
    .mockResolvedValueOnce({ candidates: [], truncated: false });
  await openSearch({ findCandidates, onCompare: jest.fn() });
  const check = () => fireEvent.press(screen.getByRole('button', { name: 'Check catalog' }));
  await check();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not check the catalog. Try again.');
  expect(screen.queryByText('No matching products found')).not.toBeOnTheScreen();
  await check();
  expect(await screen.findByText('Search was limited')).toBeOnTheScreen();
  expect(screen.queryByText('No matching products found')).not.toBeOnTheScreen();
  await check();
  expect(await screen.findByText('No matching products found')).toBeOnTheScreen();
  expect(screen.getByLabelText('Product name')).toHaveDisplayValue('Rolled Oats');
});

test('an edit cancels an in-flight search and prevents stale matches appearing against new details', async () => {
  const request = Promise.withResolvers<Awaited<ReturnType<Search>>>();
  const findCandidates = jest.fn<ReturnType<Search>, Parameters<Search>>(() => request.promise);
  await openSearch({ findCandidates, onCompare: jest.fn() });
  await fireEvent.press(screen.getByRole('button', { name: 'Check catalog' }));
  await fireEvent.changeText(screen.getByLabelText('Product name'), 'Corn Flakes');
  expect(findCandidates.mock.calls[0][1].aborted).toBe(true);
  await act(async () => { request.resolve({ candidates: [catalog], truncated: false }); });
  expect(screen.queryByRole('button', { name: 'Compare Sample Rolled Oats' })).not.toBeOnTheScreen();
});
