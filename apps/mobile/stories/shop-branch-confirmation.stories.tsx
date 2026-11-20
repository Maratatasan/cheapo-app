import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fn } from 'storybook/test';

import { ShopBranchConfirmation } from '@/component/shop/shop-branch-confirmation';

const meta = {
  title: 'Shops/Confirm shared branch',
  component: ShopBranchConfirmation,
  args: { onUse: fn(), onCreate: fn(), onBack: fn() },
} satisfies Meta<typeof ShopBranchConfirmation>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MatchingBranches: Story = {
  args: { result: { status: 'checked', shops: [
    { id: 'market-road', name: 'Market', address: '10 Market Road' },
    { id: 'high-street', name: 'Market', address: '42 High Street' },
  ] } },
  play: async ({ canvas, args, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Use Market, 10 Market Road' }));
    await expect(args.onUse).toHaveBeenCalledWith({ id: 'market-road', name: 'Market', address: '10 Market Road' });
  },
};

export const OfflineConfirmation: Story = {
  args: { result: { status: 'unavailable', shops: [] } },
};
