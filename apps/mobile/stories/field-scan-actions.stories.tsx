/// <reference types="vite/client" />
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { expect } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { MarketScanActions } from '../component/results/market-scan-actions';
import { ShopComparison } from '../component/results/shop-comparison';
import { PhotoReview } from '../component/photo-review';
import { emptyReview } from '../data/photo-review';
import { marketColor } from '../component/results/theme';

const meta = { title: 'Screens/Field scan actions', parameters: { layout: 'fullscreen', componentLibraryFrame: false } } satisfies Meta;
export default meta;

function Example() {
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState({ ...emptyReview('Sample shop'), productName: 'Rooster potatoes', packSize: '2 kg', price: '2.50' });
  const [saved, setSaved] = useState(false);
  const uri = import.meta.env.DEV ? import.meta.env.VITE_COMPARISON_SAMPLE_PHOTO : undefined;
  const reference = { id: 'ref', shop: 'Sample shop', productType: 'Fresh potatoes', price: 2.5, currency: 'GBP', unit_price: { amount: 1.25, unit: 'kg' } };
  return <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 710 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}><View style={{ height: 710, width: '100%', maxWidth: 520, backgroundColor: marketColor.background, padding: 12 }}>
    {reviewing ? <>
      <Text style={{ color: marketColor.muted, fontSize: 13 }}>Sample photo review</Text>
      <PhotoReview photo={uri ? { uri, width: 600, height: 600, mimeType: 'image/jpeg' } : undefined} review={review} saved={saved} busy={false}
      onReviewChange={next => { setReview({ ...next, packSize: next.packSize ?? '' }); setSaved(false); }} onSave={() => setSaved(true)} onRetake={() => setReviewing(false)} />
    </> : <>
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <ShopComparison reference={reference} product={{ name: 'Rooster potatoes', pack: '2 kg', photo: uri ? { uri } : undefined }} sample
          comparisons={[{ ...reference, id: 'tandem', shop: 'Tandem Centre Lidl', price: 2.48, capturedOn: '2026-11-12', unit_price: { amount: 1.24, unit: 'kg' } }]} />
      </ScrollView>
      <MarketScanActions onScanLabel={() => setReviewing(true)} />
    </>}
  </View></SafeAreaProvider>;
}

export const CompareAndScan: StoryObj = {
  render: () => <Example />,
  play: async ({ canvas, userEvent }) => {
    const barcode = canvas.getByRole('button', { name: 'Scan product barcode, coming next' });
    await expect(barcode).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'Scan label' }));
    await expect(canvas.getByText('Sample photo review')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Retake' }));
    await expect(canvas.getByRole('button', { name: 'Scan label' })).toBeVisible();
    window.scrollTo(0, 0);
  },
};
