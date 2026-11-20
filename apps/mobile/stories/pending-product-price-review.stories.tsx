import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fn } from 'storybook/test';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PendingDraftBarcodeField, PendingProductPriceReview } from '../component/pending-product-price-review';
import { PhotoReview } from '../component/photo-review';
import { emptyReview, type ManualReview } from '../data/photo-review';
import type { ProductPriceDraft } from '../data/price-append-queue';

const product = { id: 'saved-oats', name: 'Whole rolled oats', brand: 'Sample', productType: 'Oats', barcode: '00036000291452' };
const asset = { uri: new URL('./fixtures/price-label-original.jpg', import.meta.url).href,
  width: 700, height: 490, mimeType: 'image/jpeg' as const };
const frame = { x: 0, y: 0, width: 428, height: 660 };
const insets = { top: 0, right: 0, bottom: 0, left: 0 };
const meta = {
  title: 'Screens/Pending product price review',
  component: PendingProductPriceReview,
  decorators: [Story => <View style={{ width: '100%', maxWidth: frame.width, height: frame.height }}>
    <SafeAreaProvider initialMetrics={{ frame, insets }}><Story /></SafeAreaProvider>
  </View>],
  args: { busy: false, draft: { catalogOperationId: 'sample-operation', createdAt: '2026-11-20T15:00:00.000Z', barcode: product.barcode,
    record: { id: 'sample-draft', productId: 'proposed-oats', capturedAt: '2026-11-20T14:03:00.000Z', original: asset, selected: asset,
      review: { ...emptyReview('Example Market'), productName: 'Whole rolled oats', productType: 'Oats', price: '3.19' },
      shop: { id: 'sample-market', displayName: 'Example Market' } } },
    onBack: fn(), onConfirm: fn(), onRetry: fn(), onCompare: fn(),
  },
} satisfies Meta<typeof PendingProductPriceReview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NeedsProductReview: Story = {
  args: { check: { kind: 'checked', exact: true, barcode: product.barcode,
    candidates: [{ kind: 'catalog', product }], truncated: false } },
  play: async ({ args, canvas }) => {
    const reuse = await canvas.findByRole('button', { name: 'Reuse Whole rolled oats' });
    reuse.scrollIntoView({ block: 'nearest' });
    await expect(reuse).toBeEnabled();
    await expect(canvas.getByText('Reviewed price £3.19')).toBeInTheDocument();
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};

export const CatalogUnavailable: Story = {
  args: { check: { kind: 'unavailable' } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Retry product check' })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: 'Add product' })).not.toBeInTheDocument();
  },
};

function DraftDetails({ draft }: { draft: ProductPriceDraft }) {
  const { record } = draft;
  const [review, setReview] = useState<ManualReview>(() => ({ ...(record.review ?? emptyReview()), productType: '' }));
  const [barcode, setBarcode] = useState(draft.barcode ?? '');
  return <PhotoReview addingProduct updatingDraft review={review} photo={record.selected} selectedShopName={record.shop?.displayName}
    saved={false} busy={false} onReviewChange={setReview} onSave={() => {}} onCancel={() => {}}
    barcodeReview={<PendingDraftBarcodeField value={barcode} onChange={setBarcode} />} />;
}

export const EditDraftDetails: Story = {
  render: ({ draft }) => <DraftDetails draft={draft} />,
  play: async ({ canvas, userEvent }) => {
    const type = canvas.getByLabelText('Product type');
    await userEvent.type(type, 'Oats');
    await expect(type).toHaveValue('Oats');
    await expect(canvas.getByRole('button', { name: 'Save draft changes' })).toBeEnabled();
    await expect(canvas.queryByRole('button', { name: 'Confirm current price' })).not.toBeInTheDocument();
  },
};
