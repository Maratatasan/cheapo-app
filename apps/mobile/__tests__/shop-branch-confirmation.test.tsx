import { fireEvent, render, screen } from '@testing-library/react-native';

import { ShopChooser } from '@/component/shop/shop-chooser';
import type { ShopCandidateSearch } from '@/data/shop-repository';

const branch = { id: 'checked-branch', name: 'Market', address: '10 Market Road', location: { latitude: 51.4, longitude: -0.1 } };
const saved = { ...branch, nickname: 'Usual Market' };

async function addShop(result: ShopCandidateSearch) {
  const findShopCandidates = jest.fn(async () => result);
  const saveShop = jest.fn(async () => ({ shops: [saved], currentShop: saved }));
  const selected = jest.fn();
  await render(<ShopChooser state={{ shops: [] }} actions={{ findShopCandidates, saveShop, selectShop: jest.fn() }}
    onSelected={selected} onCancel={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Add a shop' }));
  await fireEvent.changeText(screen.getByLabelText('Nickname'), ' Usual Market ');
  await fireEvent.changeText(screen.getByLabelText('Shop name'), 'Market');
  await fireEvent.changeText(screen.getByLabelText('Address (optional)'), 'Market Road');
  await fireEvent.press(screen.getByRole('button', { name: 'Check shared shops' }));
  expect(findShopCandidates).toHaveBeenCalledWith({ name: 'Market', address: 'Market Road' }, expect.anything());
  expect(saveShop).not.toHaveBeenCalled();
  return { saveShop, selected };
}

test('links the confirmed stable branch and keeps its nickname private', async () => {
  const { saveShop, selected } = await addShop({ status: 'checked', shops: [branch] });
  await fireEvent.press(screen.getByRole('button', { name: 'Use Market, 10 Market Road' }));
  expect(saveShop).toHaveBeenCalledWith(saved, { select: true });
  expect(selected).toHaveBeenCalledWith({ shops: [saved], currentShop: saved });
});

test('requires an explicit new-shop action if a shared lookup is unavailable', async () => {
  const { saveShop } = await addShop({ status: 'unavailable', shops: [] });
  expect(screen.getByText(/Shared shops could not be checked/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to details' }));
  expect(screen.getByLabelText('Nickname')).toHaveDisplayValue(' Usual Market ');
  expect(saveShop).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Check shared shops' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add as a new shop' }));
  expect(saveShop).toHaveBeenCalledWith({ nickname: ' Usual Market ', name: 'Market', address: 'Market Road' }, { select: true });
});
