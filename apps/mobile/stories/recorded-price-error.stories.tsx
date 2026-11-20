import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { expect, fireEvent } from 'storybook/test';

import { PhotoReview } from '@/component/photo-review';
import { RecordedPriceError } from '@/component/recorded-price-error';
import { emptyReview } from '@/data/photo-review';

function Preview({ recorded = false }: { recorded?: boolean }) {
  const [reason, setReason] = useState<string | undefined>(recorded ? 'The price was on the wrong shelf label.' : undefined);
  const [review, setReview] = useState({ ...emptyReview('Example Market'), productName: 'Example rice', packSize: '500 g', price: '2.50' });
  return <View style={{ height: 640, width: 380, maxWidth: '100%' }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 380, height: 640 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
      <PhotoReview review={review} selectedShopName="Example Market" saved={false} busy={false}
        onReviewChange={next => setReview({ ...next, packSize: next.packSize ?? '' })} onSave={() => {}} onCancel={() => {}}>
        <RecordedPriceError reason={reason} onRecord={setReason} onUndo={() => setReason(undefined)} />
      </PhotoReview>
    </SafeAreaProvider>
  </View>;
}
const meta = { title: 'Screens/Recorded in error', component: Preview } satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithReason: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Record in error' }));
    await expect(canvas.getByRole('button', { name: 'Save reason' })).toBeDisabled();
    await fireEvent.change(canvas.getByLabelText('Reason for marking this price in error'), { target: { value: 'The price was on the wrong shelf label.' } });
    await userEvent.click(canvas.getByRole('button', { name: 'Save reason' }));
    await expect(canvas.getByText('Recorded in error', { exact: true })).toBeVisible();
  },
};
export const Undo: Story = {
  args: { recorded: true },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Undo recorded in error' }));
    await expect(canvas.getByRole('button', { name: 'Record in error' })).toBeVisible();
  },
};
