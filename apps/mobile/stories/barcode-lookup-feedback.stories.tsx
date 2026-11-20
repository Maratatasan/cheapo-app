import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native';
import { expect, fn } from 'storybook/test';

import { BarcodeLookupFeedback } from '@/component/barcode-lookup-feedback';
import { CameraActionButton } from '@/component/camera-actions';

const meta = {
  title: 'Screens/Barcode lookup', component: BarcodeLookupFeedback,
  args: { enrolled: true },
} satisfies Meta<typeof BarcodeLookupFeedback>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CheckingSharedCatalog: Story = { args: { state: 'loading' } };
export const SharedCatalogMiss: Story = { args: { state: 'missing', onAdd: fn() } };
export const UnavailableOffline: Story = {
  args: { state: 'error', detail: 'Could not check this product offline. Try again when you’re connected.' },
  render: args => <View style={{ width: 360, gap: 12 }}>
    <BarcodeLookupFeedback {...args} />
    <CameraActionButton primary label="Scan another barcode" onPress={fn()} />
    <CameraActionButton label="Scan label" onPress={fn()} />
  </View>,
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/Could not check this product offline/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Scan another barcode' })).toBeVisible();
  },
};
