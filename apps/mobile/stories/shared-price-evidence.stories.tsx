import type { PriceObservationDetail } from '@cheapo/domain/price-history';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { expect } from 'storybook/test';

import { SharedPriceEvidence, type EvidenceView } from '../component/shared-price-evidence';
import type { PriceEvidenceRole } from '../data/cheapo-price-photo-read';

const observation: PriceObservationDetail = {
  id: 'fa91641f-d265-4a3b-9695-4ff553ab5138', sourceId: 'example-oats', ownedByCurrentShopper: true, version: 1,
  capturedAt: '2026-01-02T09:30:00.123456Z', productId: 'example-oats', sourceProductId: 'example-oats',
  productName: 'Whole rolled oats', shopId: 'example-market', sourceShopId: 'example-market', shopDisplayName: 'Example Market',
  priceAmount: '3.19', currency: 'GBP', review: { brand: 'Example Mill', packSize: '500 g' },
  unitPrice: { amount: 0.638, unit: '100g' }, cropBox: { left: 0.1, top: 0.3, right: 0.9, bottom: 0.87 },
  photos: [{ role: 'original', width: 700, height: 490 }, { role: 'crop', width: 560, height: 278 }],
  selectedPhotoRole: 'crop',
};
const images = {
  original: new URL('./fixtures/price-label-original.jpg', import.meta.url).href,
  crop: new URL('./fixtures/price-label-crop.jpg', import.meta.url).href,
};
const insets = { top: 0, left: 0, bottom: 0, right: 0 };
const frame = { x: 0, y: 0, width: 428, height: 675 };

function Preview({ state }: { state: 'fresh' | 'cached' | 'pending' | 'unavailable' | 'recorded-in-error' | 'loading' }) {
  const [role, setRole] = useState<PriceEvidenceRole>('crop');
  const [refreshed, setRefreshed] = useState(false);
  const pending = state === 'pending' && !refreshed;
  const obs: PriceObservationDetail = {
    ...observation,
    ...(state === 'recorded-in-error' ? { recordedInErrorReason: 'The shelf tag was for a different pack.' } : {}),
    photos: observation.photos.map(asset => asset.role === 'crop' && pending ? { ...asset, availability: 'pending' } : asset),
  };
  const photo: EvidenceView = state === 'unavailable' || state === 'loading' ? { role, status: state }
    : { role, status: state === 'cached' ? 'cached' : 'fresh', uri: images[role] };
  return (
    <View style={{ width: '100%', maxWidth: frame.width, height: frame.height }}>
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <SharedPriceEvidence observation={obs} lastSyncedAt="2026-01-02T10:00:00.000Z" cached={state === 'cached'}
          activeRole={role} photo={pending && role === 'crop' ? undefined : photo} onPhotoRole={setRole}
          onRetryPhoto={() => setRefreshed(true)} onBack={() => {}} onCompare={() => {}} />
      </SafeAreaProvider>
    </View>
  );
}

const meta = { title: 'Screens/Saved price evidence', component: Preview, args: { state: 'fresh' } } satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const VerifiedCrop: Story = {};
export const OfflineCopy: Story = { args: { state: 'cached' } };
export const PendingUpload: Story = { args: { state: 'pending' } };
export const PhotoUnavailable: Story = { args: { state: 'unavailable' } };
export const ReadingPhoto: Story = { args: { state: 'loading' } };
export const RecordedInError: Story = { args: { state: 'recorded-in-error' } };
export const SwitchAndRefresh: Story = {
  args: { state: 'pending' },
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('Photo upload pending')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Original' }));
    await expect(canvas.getByLabelText('Original price photo')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Crop' }));
    await expect(canvas.getByText('Photo upload pending')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Check for photo' }));
    await expect(canvas.getByLabelText('Cropped price photo')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Back to saved products' })).toBeVisible();
  },
};
