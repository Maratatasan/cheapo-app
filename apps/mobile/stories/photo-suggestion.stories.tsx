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
    await expect(canvas.getByRole('radio', { name: 'Total price: £1.49' })).toBeChecked();
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

export const UncertainPrice: Story = {
  args: {
    draft: { product: 'Chopped tomatoes', packSize: null, price: 1.49, currency: 'GBP', unit_price: null,
      uncertainty: 'The last digit of the comparison price is partly obscured.', alternatives: { price: [1.79] } },
  },
  play: async ({ args, canvas, userEvent }) => {
    const other = canvas.getByRole('radio', { name: 'Total price: £1.79' });
    await expect(canvas.getByText('Total price · Uncertain')).toBeVisible();
    await expect(canvas.getByText('Pack size unconfirmed')).toBeVisible();
    canvas.getByRole('radio', { name: 'Total price: £1.49' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(other).toBeChecked();
    await expect(other).toHaveFocus();
    await expect(args.onApply).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: 'Use suggested details' }));
    await expect(args.onApply).toHaveBeenCalledWith(expect.objectContaining({ price: 1.79, packSize: null }));
  },
};
