import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fireEvent, fn } from 'storybook/test';
import { AddBarcodeProduct } from '../component/add-barcode-product';

const meta = {
  title: 'Screens/Add barcode product',
  component: AddBarcodeProduct,
  args: { barcode: '00012345678905', busy: false, onSave: fn(), onCancel: fn() },
} satisfies Meta<typeof AddBarcodeProduct>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewProduct: Story = {
  play: async ({ canvas, userEvent, args }) => {
    await fireEvent.change(canvas.getByLabelText('Product name'), { target: { value: 'Example sparkling water' } });
    await fireEvent.change(canvas.getByLabelText('Product type'), { target: { value: 'Sparkling water' } });
    await fireEvent.change(canvas.getByLabelText('Pack size (optional)'), { target: { value: '8 × 500 mL' } });
    await userEvent.click(canvas.getByRole('button', { name: 'Save product' }));
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Example sparkling water', productType: 'Sparkling water',
      pack: { quantity: 4000, unit: 'mL', label: '8 × 500 mL' },
    }));
  },
};

export const SaveError: Story = { args: { error: 'Could not save this product. Try again.' } };
