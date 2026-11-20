import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fn } from 'storybook/test';
import { View } from 'react-native';

import { PendingSync, type PendingSyncItem } from '../component/pending-sync';
import { ShopPicker } from '../component/shop/shop-picker';

type Fixture = 'pending' | 'attention' | 'syncing' | 'empty' | 'unavailable' | 'loading' | 'recovery';
const pending: readonly PendingSyncItem[] = [
  { id: 'rice', title: 'Brown rice', state: 'waiting' },
  { id: 'oats', title: 'Rolled oats', state: 'failed' },
  { id: 'yogurt', title: 'Plain yogurt', state: 'photo-pending' },
];
const attention: readonly PendingSyncItem[] = [
  { id: 'milk', title: 'Whole milk', state: 'needs-shop' },
  { id: 'oil', title: 'Olive oil', state: 'conflict' },
];
const recovery: readonly PendingSyncItem[] = [
  { id: 'yogurt', title: 'Plain yogurt', state: 'photo-failed' },
  { id: 'soup', title: 'Tomato soup', state: 'recovery' },
];

function Preview({ fixture, onChooseShop, onReviewConflict, onBack }: {
  fixture: Fixture; onChooseShop(id: string): void; onReviewConflict(id: string): void; onBack(): void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [resolved, setResolved] = useState(false);
  const items = fixture === 'attention' ? attention : resolved || fixture === 'empty' ? [] : fixture === 'recovery' ? recovery : pending;
  const snapshot = fixture === 'unavailable' && !resolved || fixture === 'loading'
    ? { state: fixture } as const : { state: 'ready', items } as const;

  async function retry() {
    setRetrying(true);
    await new Promise<void>(resolve => setTimeout(resolve, 250));
    setResolved(true);
    setRetrying(false);
  }

  return (
    <View style={{ width: '100%', maxWidth: 420, height: 600, alignSelf: 'center' }}>
      <PendingSync snapshot={snapshot} retrying={retrying || fixture === 'syncing'} onRetry={() => void retry()}
        onReload={() => setResolved(true)} onChooseShop={onChooseShop} onReviewConflict={onReviewConflict} onBack={onBack} />
    </View>
  );
}

const meta = {
  title: 'Screens/Pending sync',
  component: Preview,
  args: { fixture: 'pending', onChooseShop: fn(), onReviewConflict: fn(), onBack: fn() },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PendingAndFailed: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Saved on this phone · Waiting to sync')).toBeVisible();
    await expect(canvas.getByText('Could not sync')).toBeVisible();
    await expect(canvas.getByText('Price synced · Photo pending')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Retry sync' })).toBeEnabled();
  },
};

export const NeedsAttention: Story = {
  args: { fixture: 'attention' },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Choose shop for Whole milk' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Review conflict for Olive oil' }));
    await expect(args.onChooseShop).toHaveBeenCalledWith('milk');
    await expect(args.onReviewConflict).toHaveBeenCalledWith('oil');
  },
};

export const RetryRecovery: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Retry sync' }));
    await expect(await canvas.findByText('No changes waiting to sync.')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Retry sync' })).toBeDisabled();
  },
};

export const Syncing: Story = { args: { fixture: 'syncing' } };
export const Empty: Story = { args: { fixture: 'empty' } };
export const Unavailable: Story = { args: { fixture: 'unavailable' } };
export const Loading: Story = { args: { fixture: 'loading' } };

export const PhotoFailureAndRecovery: Story = {
  args: { fixture: 'recovery' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Price synced · Could not sync the photo')).toBeVisible();
    await expect(canvas.getByText('Held for recovery · Included in protected shopping data')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Retry sync' })).toBeEnabled();
  },
};

export const ChooseShopForPrice: Story = {
  render: args => <View style={{ width: '100%', maxWidth: 420, height: 500, alignSelf: 'center' }}>
    <ShopPicker title="Choose shop for saved price" shops={[{ id: 'fixture', name: 'Example Market', nickname: 'Weekly shop' }]}
      onSelect={shop => args.onChooseShop(shop.id)} onCancel={args.onBack} />
  </View>,
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('heading', { name: 'Choose shop for saved price' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Weekly shop Example Market' }));
    await expect(args.onChooseShop).toHaveBeenCalledWith('fixture');
  },
};
