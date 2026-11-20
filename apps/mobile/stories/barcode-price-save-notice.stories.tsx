import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { Text, View } from 'react-native';
import { expect } from 'storybook/test';

import { BarcodePriceSaveNotice } from '@/component/barcode-price-save-notice';
import { CameraActionButton } from '@/component/camera-actions';

const meta = { title: 'Screens/Barcode price save', component: BarcodePriceSaveNotice } satisfies Meta<typeof BarcodePriceSaveNotice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WaitingToSync: Story = {
  render: () => (
    <View style={{ backgroundColor: '#000', width: 360, height: 460, justifyContent: 'flex-end', padding: 16, gap: 8 }}>
      <BarcodePriceSaveNotice />
      <Text style={{ color: '#fff', textAlign: 'center' }}>Point the camera at the product barcode.</Text>
      <CameraActionButton label="Scan label" onPress={() => {}} />
    </View>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Saved on this phone · Waiting to sync')).toBeVisible();
  },
};
