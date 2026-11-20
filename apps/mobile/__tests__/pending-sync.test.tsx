import { render, screen, userEvent } from '@testing-library/react-native';

import { PendingSync, type PendingSyncItem } from '../component/pending-sync';

const actions = {
  onRetry: jest.fn(), onReload: jest.fn(), onChooseShop: jest.fn(), onReviewConflict: jest.fn(), onBack: jest.fn(),
};
const items: PendingSyncItem[] = [
  { id: 'rice', title: 'Brown rice', state: 'waiting' },
  { id: 'oats', title: 'Rolled oats', state: 'failed' },
  { id: 'yogurt', title: 'Plain yogurt', state: 'photo-pending' },
];

beforeEach(() => jest.clearAllMocks());

it('shows distinct pending, failed and photo states and offers one retry', async () => {
  const user = userEvent.setup();
  const renderResult = await render(<PendingSync {...actions} snapshot={{ state: 'ready', items }} />);
  expect(screen.getByText('Saved on this phone · Waiting to sync')).toBeVisible();
  expect(screen.getByText('Could not sync')).toBeVisible();
  expect(screen.getByText('Price synced · Photo pending')).toBeVisible();
  await user.press(screen.getByRole('button', { name: 'Retry sync' }));
  expect(actions.onRetry).toHaveBeenCalledTimes(1);
  await renderResult.rerender(<PendingSync {...actions} snapshot={{ state: 'ready', items }} retrying />);
  expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled();
  expect(screen.getByText('Rolled oats')).toBeVisible();
});

it('lets the shopper resolve missing shop and conflict entries by record', async () => {
  const user = userEvent.setup();
  const needsAttention: PendingSyncItem[] = [
    { id: 'milk', title: 'Whole milk', state: 'needs-shop' },
    { id: 'oil', title: 'Olive oil', state: 'conflict' },
  ];
  await render(<PendingSync {...actions} snapshot={{ state: 'ready', items: needsAttention }} />);
  await user.press(screen.getByRole('button', { name: 'Choose shop for Whole milk' }));
  await user.press(screen.getByRole('button', { name: 'Review conflict for Olive oil' }));
  expect(actions.onChooseShop).toHaveBeenCalledWith('milk');
  expect(actions.onReviewConflict).toHaveBeenCalledWith('oil');
  expect(screen.getByRole('button', { name: 'Retry sync' })).toBeDisabled();
});

it('reserves the empty message for a successful queue read and lets the user reload a failed read', async () => {
  const user = userEvent.setup();
  const view = await render(<PendingSync {...actions} snapshot={{ state: 'loading' }} />);
  expect(screen.getByText('Checking pending changes…')).toBeVisible();
  expect(screen.queryByText('No changes waiting to sync.')).toBeNull();
  await view.rerender(<PendingSync {...actions} snapshot={{ state: 'unavailable' }} />);
  expect(screen.getByRole('alert')).toBeVisible();
  await user.press(screen.getByRole('button', { name: 'Try again' }));
  expect(actions.onReload).toHaveBeenCalledTimes(1);
  await view.rerender(<PendingSync {...actions} snapshot={{ state: 'ready', items: [] }} />);
  expect(screen.getByText('No changes waiting to sync.')).toBeVisible();
  await user.press(screen.getByRole('button', { name: 'Back to Home' }));
  expect(actions.onBack).toHaveBeenCalledTimes(1);
});
