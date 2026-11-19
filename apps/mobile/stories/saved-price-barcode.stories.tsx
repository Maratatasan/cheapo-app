import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect } from 'storybook/test';
import { CameraActionButton } from '../component/camera-actions';
import { PhotoReview } from '../component/photo-review';
import { SavedPriceBarcode } from '../component/saved-price-barcode';
import { emptyReview, savedProductDetails } from '../data/photo-review';

const meta = { title: 'Screens/Saved price barcode link' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const code = '036000291452';
const catalogCode = '00036000291452';
const photo = { uri: 'file:///story-fixture.jpg', width: 400, height: 300, mimeType: 'image/jpeg' } as const;
const savedReview = { ...emptyReview('Example shop'), productName: 'Example jerky', productType: 'Pork jerky', packSize: '50 g', price: '1.49' };
const record = { id: 'example-price', review: savedReview, original: photo, selected: photo, capturedAt: '2026-11-19T11:00:00Z' };

function LinkExample({ known }: { known: boolean }) {
  const [review, setReview] = useState(savedReview);
  const [editing, setEditing] = useState(false);
  const [savedBarcode, setSavedBarcode] = useState<string>();
  const product = { ...savedProductDetails(savedReview), name: known ? 'Example pork jerky, 50 g' : savedReview.productName,
    id: 'example-product', barcode: catalogCode };
  return <View style={{ height: 740, width: '100%', maxWidth: 428 }}>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 428, height: 740 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
      <PhotoReview review={review} selectedShopName="Example shop" saved={false} busy={false}
        onReviewChange={setReview} onSave={() => {}} onCancel={() => {}} savedBarcode={savedBarcode}
        barcodeReview={editing ? <SavedPriceBarcode record={record} lookup={async () => known ? product : undefined}
          link={async () => ({ record: { ...record, productId: product.id }, product })}
          onLinked={setSavedBarcode} onCancel={() => setEditing(false)} />
          : <CameraActionButton label="Link barcode" onPress={() => setEditing(true)} />} />
    </SafeAreaProvider>
  </View>;
}

export const KnownProduct: Story = {
  render: () => <LinkExample known />,
  play: async ({ canvas, userEvent }) => {
    const pack = canvas.getByLabelText('Pack size');
    await userEvent.clear(pack);
    await userEvent.type(pack, '45 g');
    await userEvent.click(canvas.getByRole('button', { name: 'Link barcode' }));
    await userEvent.type(canvas.getByLabelText('Product barcode'), code);
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm barcode' }));
    await expect(await canvas.findByText('Example pork jerky, 50 g')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Link this barcode' })).toBeEnabled();
    await expect(pack).toHaveValue('45 g');
  },
};

export const UnknownProduct: Story = {
  render: () => <LinkExample known={false} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Link barcode' }));
    await userEvent.type(canvas.getByLabelText('Product barcode'), code);
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm barcode' }));
    await expect(await canvas.findByText('New product from saved details')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Create product and link' })).toBeEnabled();
  },
};
