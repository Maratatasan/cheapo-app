/// <reference types="vite/client" />
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fireEvent } from 'storybook/test';
import { PhotoReview } from '../component/photo-review';
import { CurrentShopPrice } from '../component/results/current-shop-price';
import { emptyReview, type ManualReview } from '../data/photo-review';

const meta = { title: 'Screens/Field review', component: PhotoReview } satisfies Meta<typeof PhotoReview>;
export default meta;
type Story = StoryObj<Pick<Meta<typeof PhotoReview>, 'title'>>;

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
