import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native';
import { expect } from 'storybook/test';

import { ProductPhotoEditor } from '../component/product-photo-editor';
import { ui } from '../component/results/theme';
import type { createProductPresentationPhotos } from '../data/product-presentation-photos';

const productId = 'sample-exact-product';
const oldUri = new URL('./fixtures/price-label-crop.jpg', import.meta.url).href;
const candidate = { uri: new URL('./fixtures/price-label-original.jpg', import.meta.url).href,
  width: 700, height: 490, mimeType: 'image/jpeg' as const };
const sha256 = 'a'.repeat(64);
const photos = {
  read: async () => ({ status: 'fresh' as const, photo: { uri: oldUri, width: 560, height: 278, version: 1, sha256,
    byteCount: 1000, lastSyncedAt: '2026-01-02T10:00:00Z' } }),
  prepare: async (productId, expectedVersion, asset) => ({ productId, expectedVersion, operationId: 'sample-write', sha256,
    byteCount: 1000, width: asset.width, height: asset.height }),
  replace: async () => ({ status: 'available', version: 2 }),
} satisfies ReturnType<typeof createProductPresentationPhotos>;

function Preview() {
  return <View style={[ui.page, { width: '100%', maxWidth: 428, minHeight: 560, padding: 20 }]}>
    <ProductPhotoEditor productId={productId} photos={photos} choose={async () => candidate} />
  </View>;
}

const meta = { title: 'Screens/Product photo editor', component: Preview } satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ExistingPhoto: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText('Current product photo')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Change product photo' })).toBeEnabled();
  },
};

export const PreviewReplacement: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Change product photo' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Choose from phone' }));
    await expect(canvas.getByLabelText('Current product photo')).toBeVisible();
    await expect(await canvas.findByLabelText('New product photo preview')).toBeVisible();
  },
};

export const ConfirmReplacement: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Change product photo' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Take photo' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Save product photo' }));
    await expect(await canvas.findByText('Product photo saved.')).toBeVisible();
    await expect(canvas.queryByLabelText('New product photo preview')).not.toBeInTheDocument();
  },
};
