import type { PriceObservationDetail } from '@cheapo/domain/price-history';
import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SharedPriceEvidence } from '../component/shared-price-evidence';

const observation: PriceObservationDetail = {
  id: 'fa91641f-d265-4a3b-9695-4ff553ab5138', sourceId: 'example-oats', ownedByCurrentShopper: false, version: 1,
  capturedAt: '2026-01-02T09:30:00.123456Z', productId: 'example-oats', sourceProductId: null,
  productName: 'Whole rolled oats', shopId: 'example-market', sourceShopId: null, shopDisplayName: 'Example Market',
  priceAmount: '3.19', currency: 'GBP', review: { packSize: '500 g' }, unitPrice: { amount: 0.638, unit: '100g' },
  cropBox: null, photos: [{ role: 'original', width: 800, height: 600 }, { role: 'crop', width: 400, height: 300 }],
  selectedPhotoRole: 'crop',
};
const metrics = { frame: { x: 0, y: 0, width: 428, height: 675 }, insets: { top: 0, left: 0, bottom: 0, right: 0 } };
const common = { lastSyncedAt: '2026-01-02T10:00:00.000Z', onPhotoRole: jest.fn(), onBack: jest.fn(), onRetryPhoto: jest.fn() };

beforeEach(() => jest.clearAllMocks());

test('shows cached freshness, opens the requested role and leaves a bottom back action', async () => {
  const user = userEvent.setup();
  await render(<SafeAreaProvider initialMetrics={metrics}><SharedPriceEvidence {...common} observation={observation} cached activeRole="crop"
    photo={{ role: 'crop', status: 'cached', uri: 'file:///cache/example-crop.jpg' }} /></SafeAreaProvider>);
  expect(screen.getByLabelText('Cropped price photo')).toBeOnTheScreen();
  expect(screen.getByText('Downloaded photo')).toBeOnTheScreen();
  expect(screen.getByText(/Last synced/)).toBeOnTheScreen();
  await fireEvent(screen.getByLabelText('Cropped price photo'), 'error');
  expect(screen.getByText('Photo unavailable')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Try again' }));
  expect(common.onRetryPhoto).toHaveBeenCalledTimes(1);
  await user.press(screen.getByRole('button', { name: 'Original' }));
  expect(common.onPhotoRole).toHaveBeenCalledWith('original');
  await user.press(screen.getByRole('button', { name: 'Back to saved products' }));
  expect(common.onBack).toHaveBeenCalledTimes(1);
});

test('keeps an earlier role out of the pending view and lets the shopper check again', async () => {
  const user = userEvent.setup();
  const pending = { ...observation, photos: [observation.photos[0], { ...observation.photos[1], availability: 'pending' as const }] };
  await render(<SafeAreaProvider initialMetrics={metrics}><SharedPriceEvidence {...common} observation={pending} cached={false} activeRole="crop"
    photo={{ role: 'original', status: 'fresh', uri: 'file:///cache/example-original.jpg' }} /></SafeAreaProvider>);
  expect(screen.getByText('Photo upload pending')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Original price photo')).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Check for photo' }));
  expect(common.onRetryPhoto).toHaveBeenCalledTimes(1);
});

test('shows why an observation was recorded in error and leaves the photo retry available', async () => {
  await render(<SafeAreaProvider initialMetrics={metrics}><SharedPriceEvidence {...common} observation={{ ...observation, recordedInErrorReason: 'Wrong pack' }}
    cached={false} activeRole="crop" photo={{ role: 'crop', status: 'unavailable' }} onCompare={jest.fn()} /></SafeAreaProvider>);
  expect(screen.getByText('Recorded in error')).toBeOnTheScreen();
  expect(screen.getByText('Wrong pack')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Compare saved prices' })).not.toBeOnTheScreen();
});
