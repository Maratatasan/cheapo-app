/// <reference types="vite/client" />
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fireEvent } from 'storybook/test';
import { PhotoReview } from '../component/photo-review';
import { emptyReview } from '../data/photo-review';

const meta = { title: 'Screens/Field review', component: PhotoReview } satisfies Meta<typeof PhotoReview>;
export default meta;
type Story = StoryObj<Pick<Meta<typeof PhotoReview>, 'title'>>;

function ReviewExample() {
  const photo = import.meta.env.DEV ? import.meta.env.VITE_COMPARISON_SAMPLE_PHOTO : undefined;
  const [review, setReview] = useState({ ...emptyReview('Example shop'), productName: 'Rooster potatoes', packSize: '2 kg', price: '2.50' });
  const [saved, setSaved] = useState(false);
  return <View style={{ height: 720, width: '100%' }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 720 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
      <PhotoReview photo={photo ? { uri: photo, width: 600, height: 600, mimeType: 'image/jpeg' } : undefined}
        review={review} selectedShopName="Example shop" saved={saved} busy={false}
        onReviewChange={next => { setReview({ ...next, packSize: next.packSize ?? '' }); setSaved(false); }} onSave={() => setSaved(true)} />
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
