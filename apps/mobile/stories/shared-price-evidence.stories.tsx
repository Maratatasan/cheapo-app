import type { PriceObservationDetail } from '@cheapo/domain/price-history';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { expect, waitFor } from 'storybook/test';

import { SharedPriceEvidence, type EvidenceView } from '../component/shared-price-evidence';
import { SavedPriceHistoryList, SavedPriceHistoryPane } from '../component/saved-price-history-list';
import { ui } from '../component/results/theme';
import type { PriceEvidenceRole } from '../data/cheapo-price-photo-read';
import { keptSharedPrice, projectSharedPrice, savedPriceHistoryRows, type PendingHistoryChange } from '../data/saved-price-history';

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

async function loadStoryThumbnail(id: string) {
  return id === observation.id ? images.crop : undefined;
}

function HistoryPreview() {
  const historyFrame = { ...frame, height: 720 };
  const [opened, setOpened] = useState<PriceObservationDetail>();
  const [role, setRole] = useState<PriceEvidenceRole>('crop');
  const changes: PendingHistoryChange[] = [{ operationId: 'example-correction', title: 'Correct whole rolled oats', resourceId: observation.id, state: 'waiting', change: {
    action: 'correct', review: { productName: 'Whole rolled oats', price: '3.05', currency: 'GBP', brand: 'Example Mill', packSize: '500 g' },
    unitPrice: { amount: 0.61, unit: '100g' },
  } }];
  const peer = { ...observation, id: '5353588d-923b-4f09-903d-f72adeaded5a', ownedByCurrentShopper: false,
    productName: 'Thick-cut oats', shopDisplayName: 'Peer Market' };
  const rows = savedPriceHistoryRows({ legacy: [], queued: [], shared: [observation, peer] });
  const detail = opened && projectSharedPrice(opened, changes);
  return <View style={{ width: '100%', maxWidth: historyFrame.width, height: historyFrame.height }}>
    <SafeAreaProvider initialMetrics={{ frame: historyFrame, insets }}>
      {detail ? <SharedPriceEvidence observation={detail.display} lastSyncedAt="2026-01-02T10:00:00.000Z" cached
        activeRole={role} photo={{ role, status: 'cached', uri: images[role] }} pendingChange={detail.pending}
        onPhotoRole={setRole} onRetryPhoto={() => {}} onBack={() => setOpened(undefined)} />
        : <SavedPriceHistoryList rows={rows} changes={changes} loadSharedThumbnail={loadStoryThumbnail} onOpen={row => {
          if (row.source === 'shared') setOpened(row.observation.id === observation.id ? observation : peer);
        }} header={<View><Text accessibilityRole="header" style={ui.title}>Saved products</Text>
          <Text style={ui.small}>Last synced 2 Jan 2026, 10:00</Text><Text style={ui.small}>Showing saved shared prices</Text></View>} />}
    </SafeAreaProvider>
  </View>;
}

export const SavedHistory: Story = {
  render: () => <HistoryPreview />,
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText('Saved price thumbnail')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Open Thick-cut oats' })).toBeVisible();
  },
};
export const OpenPendingHistory: Story = {
  render: () => <HistoryPreview />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('button', { name: 'Open Thick-cut oats' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Open Whole rolled oats' }));
    await expect(canvas.getByText('Saved on this phone · Waiting to sync')).toBeVisible();
    await expect(canvas.getByText('£3.05')).toBeVisible();
    await expect(canvas.getByLabelText('Cropped price photo')).toBeVisible();
  },
};

const browseRows = Array.from({ length: 18 }, (_, index): PriceObservationDetail => ({
  ...observation,
  id: `aa91641f-d265-4a3b-9695-4ff553ab${String(index + 1).padStart(4, '0')}`,
  productName: index % 3 === 0 ? `Whole rolled oats, large family breakfast pack ${index + 1}` : `Saved oats ${index + 1}`,
  capturedAt: new Date(Date.UTC(2026, 0, 25 - index, 9)).toISOString(),
  ...(index % 2 === 0 ? { photos: [], selectedPhotoRole: null } : {}),
}));
const browseHistory = savedPriceHistoryRows({ legacy: [], queued: [], shared: browseRows });
const noChanges: PendingHistoryChange[] = [];
const loadBrowseThumbnail = async () => images.crop;

function ScrolledHistoryPreview() {
  const [opened, setOpened] = useState<PriceObservationDetail>();
  return <View style={{ width: '100%', maxWidth: frame.width, height: 580 }}>
    <SafeAreaProvider initialMetrics={{ frame, insets }}>
      <SavedPriceHistoryPane rows={browseHistory} changes={noChanges} loadSharedThumbnail={loadBrowseThumbnail}
        header={<Text accessibilityRole="header" style={ui.title}>Saved products and photos</Text>}
        onOpen={row => { if (row.source === 'shared') setOpened(browseRows.find(price => price.id === row.observation.id)); }}
        detail={opened ? <SharedPriceEvidence observation={opened} cached={false} activeRole={opened.selectedPhotoRole}
          photo={opened.selectedPhotoRole ? { role: opened.selectedPhotoRole, status: 'fresh', uri: images.crop } : undefined}
          onPhotoRole={() => {}} onRetryPhoto={() => {}} onBack={() => setOpened(undefined)} /> : undefined} />
    </SafeAreaProvider>
  </View>;
}

export const ScrolledHistory: Story = { render: () => <ScrolledHistoryPreview /> };

export const ReturnToScrolledHistory: Story = {
  render: () => <ScrolledHistoryPreview />,
  play: async ({ canvas, userEvent }) => {
    const target = await canvas.findByRole('button', { name: 'Open Saved oats 8' });
    let viewport = target.parentElement;
    while (viewport && getComputedStyle(viewport).overflowY !== 'auto') viewport = viewport.parentElement;
    if (!viewport) throw Error('Could not find the saved history scroll view.');
    const scrollView = viewport;
    target.scrollIntoView({ block: 'start' });
    await waitFor(() => expect(scrollView.scrollTop).toBeGreaterThan(0));
    const offset = scrollView.scrollTop;
    const position = target.getBoundingClientRect().top - scrollView.getBoundingClientRect().top;

    await userEvent.click(target);
    await expect(canvas.getByRole('button', { name: 'Back to saved products' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Open Saved oats 8' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Back to saved products' }));

    const returned = await canvas.findByRole('button', { name: 'Open Saved oats 8' });
    await expect(returned).toBe(target);
    await expect(scrollView.scrollTop).toBe(offset);
    await expect(returned.getBoundingClientRect().top - scrollView.getBoundingClientRect().top).toBeCloseTo(position, 0);
  },
};

export const ReopenCachedHistory: Story = {
  render: () => <HistoryPreview />,
  play: async ({ canvas, userEvent }) => {
    const open = () => userEvent.click(canvas.getByRole('button', { name: 'Open Whole rolled oats' }));
    await open();
    await expect(canvas.getByLabelText('Cropped price photo')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Back to saved products' }));
    await open();
    await expect(canvas.getByText('Showing saved details')).toBeVisible();
    await expect(canvas.getByLabelText('Cropped price photo')).toBeVisible();
  },
};

export const KeptCloudOffline: Story = {
  render: () => {
    const chosen = { ...observation, version: 2, priceAmount: '3.45', selectedPhotoRole: 'original' as const };
    const changes: PendingHistoryChange[] = [{ operationId: 'example-cloud-choice', title: 'Keep cloud', resourceId: chosen.id,
      state: 'acknowledged', acceptedVersion: chosen.version, change: { action: 'keep_cloud', observation: chosen } }];
    const kept = keptSharedPrice(observation.id, changes);
    if (!kept) throw Error('Expected the saved example price.');
    return <View style={{ width: '100%', maxWidth: frame.width, height: frame.height }}>
      <SafeAreaProvider initialMetrics={{ frame, insets }}>
        <SharedPriceEvidence observation={kept} cached activeRole="original"
          photo={{ role: 'original', status: 'cached', uri: images.original }} onPhotoRole={() => {}}
          onRetryPhoto={() => {}} onBack={() => {}} />
      </SafeAreaProvider>
    </View>;
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('£3.45')).toBeVisible();
    await expect(canvas.getByText('Showing saved details')).toBeVisible();
    await expect(canvas.getByLabelText('Original price photo')).toBeVisible();
  },
};

function RevisedPhotoPreview({ selected }: { selected: PriceEvidenceRole }) {
  const observationForView: PriceObservationDetail = {
    ...observation,
    version: 2,
    cropSource: 'original',
    cropBox: selected === 'crop' ? observation.cropBox : null,
    selectedPhotoRole: selected,
  };
  const [role, setRole] = useState(selected);
  return <View style={{ width: '100%', maxWidth: frame.width, height: frame.height }}>
    <SafeAreaProvider initialMetrics={{ frame, insets }}>
      <SharedPriceEvidence observation={observationForView} cached activeRole={role}
        photo={{ role, status: 'cached', uri: images[role] }} onPhotoRole={setRole}
        onRetryPhoto={() => {}} onBack={() => {}} />
    </SafeAreaProvider>
  </View>;
}

export const RevisedCrop: Story = {
  render: () => <RevisedPhotoPreview selected="crop" />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByLabelText('Cropped price photo')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Original' }));
    await expect(canvas.getByLabelText('Original price photo')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Crop' }));
  },
};

export const RevertedToOriginal: Story = {
  render: () => <RevisedPhotoPreview selected="original" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText('Original price photo')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Crop' })).toBeNull();
  },
};
