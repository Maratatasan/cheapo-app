import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native';
import { expect, fn } from 'storybook/test';

import { ShoppingConflictReview } from '@/component/shopping-conflict';

const values = (price: string, unitPrice: string) => [
  { label: 'Product', value: 'Example basmati rice' }, { label: 'Pack size', value: '500 g' },
  { label: 'Price', value: price }, { label: 'Unit price', value: unitPrice },
  { label: 'Shop', value: 'Example Market' },
];
const meta = {
  title: 'Screens/Shopping conflict', component: ShoppingConflictReview,
  decorators: [Story => <View style={{ minHeight: 530, width: 390, maxWidth: '100%' }}><Story /></View>],
  args: { conflict: { title: 'Example basmati rice', phone: values('£2.25', '£4.50 / kg'), cloud: values('£2.75', '£5.50 / kg'),
    laterEdits: [{ id: 'later-edit', title: 'Fix unit price' }] }, onKeepPhone: fn(), onKeepCloud: fn(), onClose: fn() },
} satisfies Meta<typeof ShoppingConflictReview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CompareVersions: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('heading', { name: 'On this phone' })).toBeVisible();
    await expect(canvas.getByText('£5.50 / kg')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Keep phone' }));
    await expect(args.onKeepPhone).toHaveBeenCalledOnce();
  },
};

export const CloudConfirmation: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Keep cloud' }));
    await expect(canvas.getByRole('heading', { name: 'Keep the cloud version?' })).toBeVisible();
    await expect(canvas.getByText('Fix unit price')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm keep cloud' }));
    await expect(args.onKeepCloud).toHaveBeenCalledWith(['later-edit']);
  },
};
