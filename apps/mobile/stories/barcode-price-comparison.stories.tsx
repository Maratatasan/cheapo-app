import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fn } from 'storybook/test';
import { View } from 'react-native';

import { BarcodePriceComparison } from '@/component/barcode-price-comparison';

const meta = {
  title: 'Screens/Barcode saved prices', component: BarcodePriceComparison,
  args: {
    currentShop: { id: 'market', displayName: 'Market Road' },
    currentPrice: { price: 4.12, currency: 'GBP', capturedOn: '2026-11-19' },
    comparison: {
      product: { name: 'Rooster potatoes', pack: '2 kg' }, catalogProduct: { productType: 'Fresh potatoes' },
      comparisons: [{ id: 'high-street', productType: 'Fresh potatoes', shop: 'High Street shop',
        price: 3.8, currency: 'GBP', unit_price: { amount: 1.9, unit: 'kg' }, capturedOn: '2026-11-18' }],
    },
    onRecord: fn(),
    onMore: fn(),
  },
} satisfies Meta<typeof BarcodePriceComparison>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CachedSharedPrices: Story = {
  args: { history: { lastSyncedAt: '2026-11-20T04:00:00.000Z', cached: true, unavailable: false, hasMore: true } },
  render: args => <View style={{ width: 360, gap: 12 }}><BarcodePriceComparison {...args} /></View>,
  play: async ({ canvas, args, userEvent }) => {
    await expect(canvas.getByText(/^Last synced/)).toBeVisible();
    await expect(canvas.getByText('£4.12 pack')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Load more saved prices' }));
    await expect(args.onMore).toHaveBeenCalledTimes(1);
  },
};
