import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fn } from 'storybook/test';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AddProductPriceReview } from '../component/add-product-price-review';
import label from './fixtures/price-label-crop.jpg';

const shop = { id: 'sample-market', displayName: 'Example Market' };
const product = { id: 'sample-oats', name: 'Whole rolled oats', productType: 'Oats', brand: 'Example',
  comparableGroupId: 'oats', barcode: '00036000291452' };
const frame = { x: 0, y: 0, width: 428, height: 660 };
const insets = { top: 0, right: 0, bottom: 0, left: 0 };
const meta = {
  title: 'Screens/Add product price review',
  component: AddProductPriceReview,
  decorators: [Story => <View style={{ width: '100%', maxWidth: frame.width, height: frame.height }}>
    <SafeAreaProvider initialMetrics={{ frame, insets }}><Story /></SafeAreaProvider>
  </View>],
  args: { shop, initialBarcode: product.barcode, initialReview: { price: '3.19' },
    lookup: { findByBarcode: async () => product, findCandidates: async () => ({ candidates: [], truncated: false }) },
    loadLatestPrice: async () => ({ price: 3.19, currency: 'GBP', capturedOn: '2026-11-16' }),
    onChooseShop: fn(), onCompare: fn(), onSubmit: fn(async () => 'queued' as const), onCancel: fn(),
  },
} satisfies Meta<typeof AddProductPriceReview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConfirmCurrentShopPrice: Story = {
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Check product' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Use Whole rolled oats' }));
    await expect(await canvas.findByText('Last recorded at Example Market · £3.19 · 16 Nov 2026')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Confirm current price' })).toBeEnabled();
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

const photo = { uri: label, mimeType: 'image/jpeg', width: 600, height: 400 } as const;
export const ReviewPriceWithPhoto: Story = {
  ...ConfirmCurrentShopPrice,
  args: { photo: { id: 'sample-price-photo', capturedAt: '2026-11-20T12:00:00Z', original: photo, selected: photo } },
};

export const SaveDraftWhenUnavailable: Story = {
  args: { initialReview: { productName: 'Whole rolled oats', price: '3.19' }, lookup: {
    findByBarcode: async () => { throw Error('Sample catalog unavailable.'); },
    findCandidates: async () => ({ candidates: [], truncated: false }),
  } },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Check product' }));
    await expect(await canvas.findByRole('button', { name: 'Save draft for review' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Confirm current price' })).toBeDisabled();
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

export const ScanBarcodeForAdd: Story = {
  args: { initialBarcode: '', initialReview: { productName: 'Whole rolled oats' },
    onScanBarcode: fn(read => read('036000291452')) },
  play: async ({ args, canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Scan barcode' }));
    await expect(canvas.getByLabelText('Product barcode (optional)')).toHaveValue('036000291452');
    await expect(canvas.getByLabelText('Product name')).toHaveValue('Whole rolled oats');
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};
