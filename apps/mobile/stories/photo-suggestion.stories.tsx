import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fn } from 'storybook/test';
import { PhotoSuggestion } from '../component/photo-analysis-review';

const meta = {
  title: 'Cards/Photo suggestion',
  component: PhotoSuggestion,
  args: {
    draft: { product: 'Chopped tomatoes', packSize: '500 g', price: 1.49, currency: 'GBP', unit_price: null, uncertainty: '' },
    disabled: false,
    onApply: fn(),
  },
} satisfies Meta<typeof PhotoSuggestion>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText('Chopped tomatoes · £1.49')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Use suggested details' }));
    await expect(args.onApply).toHaveBeenCalledOnce();
  },
};

export const LongDetails: Story = {
  args: {
    draft: {
      product: 'Organic vine-ripened chopped tomatoes with basil and extra virgin olive oil',
      brand: 'Example Organic Pantry', packSize: null, price: null, currency: null, unit_price: null,
      productType: 'Tinned tomatoes', variety: 'Vine-ripened', uncertainty: 'The total price is partly outside the photo.',
    },
  },
  render: args => <div style={{ maxWidth: 320 }}><PhotoSuggestion {...args} /></div>,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Use suggested details' })).toBeVisible();
  },
};
