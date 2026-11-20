/// <reference types="vite/client" />
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fireEvent, waitFor } from 'storybook/test';
import { PhotoAnalysisControls } from '../component/photo-analysis-review';
import { PhotoReview } from '../component/photo-review';
import { PhotoPriceReviewAction } from '../component/photo-price-review-action';
import { CurrentShopPrice } from '../component/results/current-shop-price';
import { applyPhotoSuggestion, emptyReview, type ManualReview } from '../data/photo-review';
import cropLabel from './fixtures/price-label-crop.jpg';
import originalLabel from './fixtures/price-label-original.jpg';

const meta = { title: 'Screens/Field review', component: PhotoReview } satisfies Meta<typeof PhotoReview>;
export default meta;
type Story = StoryObj<Pick<Meta<typeof PhotoReview>, 'title'>>;

function ShelfPhotoReviewExample({ noPrice = false }: { noPrice?: boolean }) {
  const shop = 'Example Market';
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState<ManualReview>({ ...emptyReview(shop), productName: 'Whole rolled oats', packSize: '500 g', price: noPrice ? '' : '3.19' });
  const photo = { uri: cropLabel, width: 600, height: 400, mimeType: 'image/jpeg' as const };
  return <View style={{ height: 750, width: 390, maxWidth: '100%' }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 750 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
      {open ? <PhotoReview photo={noPrice ? undefined : photo} review={review} selectedShopName={shop} recordingPrice currentPriceConfirmation
        saved={saved} busy={false} onReviewChange={setReview}
        onSave={() => setSaved(true)} onCancel={() => setOpen(false)}>
        {noPrice ? <PhotoAnalysisControls label="Analyse anyway" onPress={() => {}} /> : null}
      </PhotoReview> : <View style={{ padding: 18, gap: 12 }}>
        <Text accessibilityRole="header">Whole rolled oats</Text>
        <PhotoPriceReviewAction status={noPrice ? 'no-price' : 'clear'} onReview={() => setOpen(true)} />
      </View>}
    </SafeAreaProvider>
  </View>;
}

export const LocalShelfPriceReview: Story = {
  render: () => <ShelfPhotoReviewExample />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Review price from photo' }));
    await expect(canvas.getByLabelText('Pack price')).toHaveValue('3.19');
    await expect(canvas.getByRole('button', { name: 'Confirm current price' })).toBeEnabled();
  },
};

export const PhotoWithoutShelfPrice: Story = {
  render: () => <ShelfPhotoReviewExample noPrice />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Review price from photo' }));
    await expect(canvas.getByLabelText('Pack price')).toHaveValue('');
    await expect(canvas.getByRole('button', { name: 'Confirm current price' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Analyse anyway' })).toBeVisible();
  },
};

function ReviewExample({ productName = 'Rooster potatoes', packSize = '2 kg', price = '2.50' }: Partial<ManualReview>) {
  const photo = import.meta.env.DEV ? import.meta.env.VITE_COMPARISON_SAMPLE_PHOTO : undefined;
  const [review, setReview] = useState<ManualReview>({ ...emptyReview('Example shop'), productName, packSize, price });
  const [saved, setSaved] = useState(false);
  return <View style={{ height: 720, width: '100%' }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 720 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
      <PhotoReview photo={photo ? { uri: photo, width: 600, height: 600, mimeType: 'image/jpeg' } : undefined}
        review={review} selectedShopName="Example shop" saved={saved} busy={false}
        onReviewChange={next => { setReview(next); setSaved(false); }} onSave={() => setSaved(true)} />
    </SafeAreaProvider>
  </View>;
}

export const PriceCalculation: Story = {
  render: () => <ReviewExample />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('£1.25 / kg')).toBeVisible();
    await fireEvent.change(canvas.getByLabelText('Pack size'), { target: { value: '500 g' } });
    await expect(canvas.getByText('£5.00 / kg')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Save Price' }));
    await expect(canvas.getByText('On this phone')).toBeVisible();
  },
};

function QueuedPhotoExample({ needsShop = false, synced = false }: { needsShop?: boolean; synced?: boolean }) {
  const shop = 'Example shop';
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState<ManualReview>({
    ...emptyReview(shop), productName: 'Example basmati rice', packSize: '500 g', price: '2.50',
  });
  const status = needsShop ? 'Saved on this phone · Needs shop' : synced ? 'Synced to Cheapo' : 'Saved on this phone · Waiting to sync';
  return <View style={{ height: 700, width: 360, maxWidth: '100%' }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 700 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
      <PhotoReview review={review} selectedShopName={needsShop ? undefined : shop} saved={saved}
        savedStatus={saved ? status : undefined} busy={false} onReviewChange={setReview} onSave={() => setSaved(true)} />
    </SafeAreaProvider>
  </View>;
}

export const PhotoWaitingToSync: Story = {
  render: () => <QueuedPhotoExample />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save Price' }));
    await expect(canvas.getByText('Saved on this phone · Waiting to sync')).toBeVisible();
  },
};

export const PhotoNeedsShop: Story = {
  render: () => <QueuedPhotoExample needsShop />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save Price' }));
    await expect(canvas.getByText('Saved on this phone · Needs shop')).toBeVisible();
  },
};

export const PhotoSynced: Story = {
  render: () => <QueuedPhotoExample synced />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save Price' }));
    await expect(canvas.getByText('Synced to Cheapo')).toBeVisible();
  },
};

function SavedPhotoSelectionPreview() {
  const [showOriginal, setOriginal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState<ManualReview>({
    ...emptyReview('Example Market'), productName: 'Whole rolled oats', packSize: '500 g', price: '3.19',
  });
  const photo = { uri: showOriginal ? originalLabel : cropLabel, width: 600, height: 400, mimeType: 'image/jpeg' as const };
  return <View style={{ height: 720, maxWidth: '100%', width: 380 }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 380, height: 720 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
      <PhotoReview photo={photo} review={review} selectedShopName="Example Market" saved={saved}
        savedStatus={saved ? 'Saved on this phone · Waiting to sync' : undefined} busy={false}
        onReviewChange={next => { setReview(next); setSaved(false); }} onSave={() => setSaved(true)}
        onCrop={() => { setOriginal(false); setSaved(false); }} onOriginal={showOriginal ? undefined : () => { setOriginal(true); setSaved(false); }} />
    </SafeAreaProvider>
  </View>;
}

export const ReopenSavedPhoto: Story = {
  render: () => <SavedPhotoSelectionPreview />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByLabelText('Price photo preview')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Use original' }));
    await expect(canvas.queryByRole('button', { name: 'Use original' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: 'Save Price' }));
    await expect(canvas.getByText('Saved on this phone · Waiting to sync')).toBeVisible();
  },
};

export const MultipackReview: Story = {
  render: () => <ReviewExample productName="Sparkling water" packSize="8 × 500" price="3.20" />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText(/include the count and size of each pack/)).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Save on this phone' })).toBeVisible();
    const packSize = canvas.getByLabelText('Pack size');
    await fireEvent.change(packSize, { target: { value: '8 × 500 mL' } });
    await expect(canvas.getByText('£0.80 / litre')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Save Price' }));
    await expect(canvas.getByText('On this phone')).toBeVisible();
    await expect(packSize).toHaveValue('8 × 500 mL');
  },
};

function CurrentPriceExample({ existing = false }: { existing?: boolean }) {
  const shop = 'Example shop';
  const [recording, setRecording] = useState(false);
  const [review, setReview] = useState<ManualReview>({
    ...emptyReview(shop), productName: 'Example basmati rice', packSize: '500 g',
  });
  return <View style={{ height: 700, width: '100%' }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 700 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
      {recording ? <PhotoReview review={review} selectedShopName={shop} recordingPrice saved={false} busy={false}
        onReviewChange={setReview} onSave={() => setRecording(false)} onCancel={() => setRecording(false)} />
        : <CurrentShopPrice shop={shop} observation={existing ? { price: 2.5, currency: 'GBP', capturedOn: '2026-11-12' } : undefined}
          onRecord={() => setRecording(true)} />}
    </SafeAreaProvider>
  </View>;
}

export const AddCurrentShopPrice: Story = {
  render: () => <CurrentPriceExample />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('No price saved at this shop')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Add price' }));
    await expect(canvas.getByRole('button', { name: 'Save Price' })).toBeDisabled();
    await fireEvent.change(canvas.getByLabelText('Pack price'), { target: { value: '2.10' } });
    await expect(canvas.getByText('£4.20 / kg')).toBeVisible();
  },
};

export const UpdateCurrentShopPrice: Story = {
  render: () => <CurrentPriceExample existing />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Recorded 12 Nov 2026')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Update price' })).toBeVisible();
  },
};

const exampleSuggestion = {
  product: 'Chopped tomatoes', packSize: '500 g', price: 1.49, currency: 'GBP', unit_price: null, uncertainty: '',
};
const longSuggestion = {
  ...exampleSuggestion,
  product: 'Organic vine-ripened chopped tomatoes with basil and extra virgin olive oil',
  brand: 'Example Organic Pantry',
  productType: 'Tinned tomatoes',
  variety: 'Vine-ripened Italian plum tomatoes',
  unit_price: { amount: 2.98, unit: 'kg' },
  uncertainty: 'The unit price is small on the shelf label. Check the amount against the original photo. The pack size is printed at the bottom of the label. The label is partly obscured. Check these values before deciding whether to use them.',
};
const readyMessage = 'Suggestions ready. Check the details before applying.';
const errorMessage = 'Photo analysis failed. You can still enter details manually.';

const uncertainSuggestion = {
  ...exampleSuggestion,
  brand: 'Orchard Pantry',
  packSize: null,
  alternatives: { price: [1.79] },
};

function SuggestionsExample({ fails = false, long = false, uncertain = false }: { fails?: boolean; long?: boolean; uncertain?: boolean }) {
  const suggestion = uncertain ? uncertainSuggestion : long ? longSuggestion : exampleSuggestion;
  const edited = useRef(new Set<keyof ManualReview>());
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed' | 'applied'>('idle');
  const [review, setReview] = useState<ManualReview>(() => emptyReview('Example shop'));
  const [saved, setSaved] = useState(false);
  const status = {
    idle: undefined,
    loading: 'Analysing the selected photo…',
    ready: readyMessage,
    failed: errorMessage,
    applied: 'Suggestions added. Review or edit before saving.',
  }[state];

  return <View style={{ width: '100%', maxWidth: 320 }}>
    <View testID="short-review-screen">
      <View style={{ paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#fff' }}>
        <Text style={{ fontWeight: '700' }}>Review photo</Text>
      </View>
      <View testID="short-review-viewport" style={{ height: 318 }}>
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 320, height: 318 }, insets: { top: 0, bottom: 8, left: 0, right: 0 } }}>
          <PhotoReview review={review} selectedShopName="Example shop" saved={saved} busy={false}
            onReviewChange={(next, field) => { edited.current.add(field); setReview(next); }}
            onRetake={() => { edited.current.clear(); setReview(emptyReview('Example shop')); setState('idle'); setSaved(false); }}
            onSave={() => setSaved(true)} suggestion={state === 'ready' ? {
              draft: suggestion,
              onApply: selected => {
                setReview(current => applyPhotoSuggestion(current, selected, edited.current));
                setState('applied');
              },
            } : undefined}>
            <PhotoAnalysisControls label={state === 'loading' ? 'Analysing…' : 'Analyse photo'} status={status}
              disabled={state === 'loading'} onPress={() => setState('loading')} />
          </PhotoReview>
        </SafeAreaProvider>
      </View>
    </View>
    <button type="button" disabled={state !== 'loading'} onClick={() => setState(fails ? 'failed' : 'ready')}>
      {fails ? 'Simulate analysis failure' : 'Complete sample analysis'}
    </button>
  </View>;
}

function verticalBounds(element: HTMLElement) {
  const { top, bottom } = element.getBoundingClientRect();
  return { top, bottom };
}

export const SuggestionsWithShortViewport: Story = {
  render: () => <SuggestionsExample />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Analyse photo' }));
    const packSize = canvas.getByLabelText('Pack size');
    packSize.focus();
    await fireEvent.change(packSize, { target: { value: '450 g' } });
    await fireEvent.click(canvas.getByRole('button', { name: 'Complete sample analysis' }));

    const viewport = canvas.getByTestId('short-review-viewport');
    const apply = canvas.getByRole('button', { name: 'Use suggested details' });
    const product = canvas.getByLabelText('Product name');
    const bounds = verticalBounds(viewport);
    const suggestionHeading = canvas.getByRole('heading', { name: 'Suggested details' });
    await waitFor(() => expect(verticalBounds(suggestionHeading).top).toBeCloseTo(bounds.top, 0));
    await expect(canvas.getByRole('radio', { name: 'Total price: £1.49' })).toBeChecked();
    await expect(packSize).toHaveFocus();
    await expect(packSize).toHaveValue('450 g');
    await expect(product).toHaveValue('');
    await expect(canvas.getByRole('button', { name: 'Save on this phone' })).toBeVisible();

    await userEvent.click(apply);

    await waitFor(() => {
      const field = verticalBounds(product);
      expect(field.top - bounds.top).toBeLessThan(64);
      expect(field.top).toBeGreaterThanOrEqual(bounds.top);
    });
    await expect(product).toHaveValue('Chopped tomatoes');
    await expect(product).not.toHaveFocus();
    await expect(packSize).toHaveValue('450 g');
    await expect(canvas.queryByText('On this phone')).not.toBeInTheDocument();
  },
};

export const LongSuggestionsScrollWithReview: Story = {
  render: () => <SuggestionsExample long />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Analyse photo' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Complete sample analysis' }));

    const viewport = canvas.getByTestId('short-review-viewport');
    const heading = canvas.getByRole('heading', { name: 'Suggested details' });
    const apply = canvas.getByRole('button', { name: 'Use suggested details' });
    const finalDetail = canvas.getByText(longSuggestion.uncertainty);
    const saveDraft = canvas.getByRole('button', { name: 'Save on this phone' });
    await waitFor(() => expect(verticalBounds(heading).top).toBeCloseTo(verticalBounds(viewport).top, 0));
    await expect(verticalBounds(apply).top).toBeGreaterThan(verticalBounds(saveDraft).top);
    await expect(verticalBounds(finalDetail).bottom).toBeLessThan(verticalBounds(apply).top);

    apply.scrollIntoView({ block: 'end' });
    await waitFor(() => expect(verticalBounds(apply).bottom).toBeLessThan(verticalBounds(saveDraft).top));
    await expect(verticalBounds(finalDetail).bottom).toBeGreaterThan(verticalBounds(viewport).top);
    await userEvent.click(apply);
    await expect(canvas.getByLabelText('Product name')).toHaveValue(longSuggestion.product);
  },
};

export const ChooseUncertainPrice: Story = {
  render: () => <SuggestionsExample uncertain />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Analyse photo' }));
    const brand = canvas.getByLabelText('Brand');
    await fireEvent.change(brand, { target: { value: 'My corrected brand' } });
    await userEvent.click(canvas.getByRole('button', { name: 'Complete sample analysis' }));
    const primary = canvas.getByRole('radio', { name: 'Total price: £1.49' });
    const other = canvas.getByRole('radio', { name: 'Total price: £1.79' });
    const packPrice = canvas.getByLabelText('Pack price');
    await expect(primary).toBeChecked();
    await expect(canvas.getByText('Pack size unconfirmed')).toBeVisible();
    await userEvent.click(other);
    await expect(other).toBeChecked();
    await expect(packPrice).toHaveValue('');

    await userEvent.click(canvas.getByRole('button', { name: 'Use suggested details' }));
    await expect(packPrice).toHaveValue('1.79');
    await expect(brand).toHaveValue('My corrected brand');
    await expect(canvas.queryByText('On this phone')).not.toBeInTheDocument();
  },
};

export const AnalysisFailureKeepsEdit: Story = {
  render: () => <SuggestionsExample fails />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Analyse photo' }));
    const packSize = canvas.getByLabelText('Pack size');
    packSize.focus();
    await fireEvent.change(packSize, { target: { value: '450 g' } });
    const before = verticalBounds(packSize);
    await fireEvent.click(canvas.getByRole('button', { name: 'Simulate analysis failure' }));

    await expect(canvas.getByText(errorMessage)).toHaveAttribute('aria-live', 'polite');
    await expect(packSize).toHaveFocus();
    await expect(packSize).toHaveValue('450 g');
    await expect(verticalBounds(packSize).top).toBeCloseTo(before.top, 0);
    await expect(canvas.queryByRole('button', { name: 'Use suggested details' })).not.toBeInTheDocument();
  },
};
