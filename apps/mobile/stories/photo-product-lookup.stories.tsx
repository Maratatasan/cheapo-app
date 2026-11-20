import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, fn } from 'storybook/test';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PhotoProductLookup, type ProductPhotoLookupProps } from '../component/photo-product-lookup';

const photo = { uri: new URL('./fixtures/price-label-original.jpg', import.meta.url).href,
  width: 700, height: 490, mimeType: 'image/jpeg' as const };
const product = { id: 'example-oats', name: 'Whole rolled oats', productType: 'Oats', barcode: '00036000291452' };
const frame = { x: 0, y: 0, width: 428, height: 660 };
const insets = { top: 0, right: 0, bottom: 0, left: 0 };
const knownCode = { status: 'found', codes: ['036000291452'] } as const;
const findSavedProduct: ProductPhotoLookupProps['findProduct'] = async code => code === product.barcode ? product : undefined;

const meta = {
  title: 'Screens/Photo product lookup',
  component: PhotoProductLookup,
  decorators: [Story => <View style={{ width: '100%', maxWidth: frame.width, height: frame.height }}>
    <SafeAreaProvider initialMetrics={{ frame, insets }}><Story /></SafeAreaProvider>
  </View>],
  args: { photo, decoded: knownCode, findProduct: findSavedProduct, onCompare: fn(), onRetake: fn() },
} satisfies Meta<typeof PhotoProductLookup>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FoundByPhotoBarcode: Story = {
  play: async ({ args, canvas }) => {
    await expect(await canvas.findByRole('heading', { name: product.name })).toBeVisible();
    await expect(canvas.getByLabelText('Product photo')).toBeVisible();
    await expect(canvas.queryByLabelText('Pack price')).not.toBeInTheDocument();
    await expect(args.onCompare).toHaveBeenCalledWith(product.barcode, product);
  },
};

export const CheckedMiss: Story = { args: { findProduct: async () => undefined } };

export const UnavailableCatalog: Story = { args: { findProduct: async () => { throw Error('Sample catalog unavailable.'); } } };

export const EnterCodeFromPackaging: Story = {
  args: { decoded: { status: 'empty' } },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByText('No product barcode found in the photo.')).toBeVisible();
    await userEvent.type(canvas.getByLabelText('Product barcode'), '036000291452');
    await userEvent.click(canvas.getByRole('button', { name: 'Find product' }));
    await expect(await canvas.findByRole('heading', { name: product.name })).toBeVisible();
    await expect(args.onCompare).toHaveBeenCalledWith(product.barcode, product);
  },
};
