import { useState } from 'react';
import { Modal, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, within } from 'storybook/test';

import { AddBarcodeProduct } from '../component/add-barcode-product';
import { CameraActionButton } from '../component/camera-actions';
import { PhotoBarcodeCatalogMatch, PhotoBarcodeMissing, PhotoBarcodeReview } from '../component/photo-barcode-review';
import { PhotoReview } from '../component/photo-review';
import type { AiPriceDraft } from '../data/ai-observation';
import type { PhotoBarcodeResult } from '../data/photo-barcode';
import { applyPhotoSuggestion, emptyReview } from '../data/photo-review';
import { canonicalProductBarcode } from '../data/product-barcode';

const meta = { title: 'Screens/Photo barcode review' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const reviewMetrics = { frame: { x: 0, y: 0, width: 428, height: 740 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } };

const candidates: PhotoBarcodeResult = { status: 'found', codes: ['0036000291452', '4006381333931'] };
const suggestion: AiPriceDraft = {
  product: 'Fresh tomatoes', productType: 'Tomatoes', price: 2.5, currency: 'GBP',
  packSize: '500 g', unit_price: null, uncertainty: '',
};

function ReviewExample({ result, conflict = false, savedBarcode, carriedBarcode, productName }: {
  result?: PhotoBarcodeResult; conflict?: boolean; savedBarcode?: string; carriedBarcode?: string; productName?: string;
}) {
  const [review, setReview] = useState(() => ({ ...emptyReview('Example shop'), productName: productName ?? '' }));
  const [showSuggestion, setShowSuggestion] = useState(!savedBarcode && !carriedBarcode);
  const [value, setValue] = useState(conflict ? '4006381333931' : carriedBarcode ?? '');
  const [confirmed, setConfirmed] = useState(conflict);
  const [saved, setSaved] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <View style={{ height: 740, width: '100%', maxWidth: 428 }}>
      <SafeAreaProvider initialMetrics={reviewMetrics}>
        <PhotoReview review={review} selectedShopName="Example shop" saved={saved} busy={false}
          savedBarcode={savedBarcode} recordingPrice={Boolean(savedBarcode)}
          onReviewChange={setReview} onSave={() => { if (!conflict || !confirmed) setSaved(true); }}
          saveError={conflict && confirmed ? 'This barcode already has a saved product. Scan it again to open that product.' : undefined}
          suggestion={showSuggestion ? { draft: suggestion, onApply: selected => {
            setReview(current => applyPhotoSuggestion(current, selected, new Set()));
            setShowSuggestion(false);
          } } : undefined}
          barcodeReview={<PhotoBarcodeReview result={result} value={value} confirmed={confirmed} carried={value === carriedBarcode}
            busy={false} error={error} onChange={next => { setValue(next); setError(undefined); }}
            onConfirm={() => {
              if (canonicalProductBarcode(value)) setConfirmed(true);
              else setError('Enter a valid product barcode.');
            }}
            onClear={() => { setValue(''); setConfirmed(false); }} onScan={() => setScanning(true)} />}
        />
        {scanning ? <Modal visible onRequestClose={() => setScanning(false)}>
          <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'flex-end', gap: 8, padding: 16 }}>
            <CameraActionButton label="Read example barcode" onPress={() => {
              setValue('5449000152473'); setConfirmed(false); setError(undefined); setScanning(false);
            }} />
            <CameraActionButton label="Cancel scan" onPress={() => setScanning(false)} />
          </View>
        </Modal> : null}
      </SafeAreaProvider>
    </View>
  );
}

export const MultipleCandidates: Story = { render: () => <ReviewExample result={candidates} /> };

function CatalogReviewExample({ initial = 'ready' }: { initial?: 'ready' | 'matching' | 'unavailable' | 'missing' }) {
  const [state, setState] = useState(initial);
  const [value, setValue] = useState('0036000291452');
  const [selected, setSelected] = useState(false);
  const [review, setReview] = useState(() => ({ ...emptyReview('Example shop'), price: '2.50' }));
  const checked = state === 'matching' || state === 'missing';
  const blocked = state === 'matching' && !selected ? 'Choose whether to use the saved product before saving.'
    : state === 'unavailable' ? 'Retry the barcode lookup, or remove the entry to save without it.' : undefined;
  return <View style={{ height: 740, width: '100%', maxWidth: 428 }}>
    <SafeAreaProvider initialMetrics={reviewMetrics}>
      <PhotoReview review={review} selectedShopName="Example shop" saved={false} busy={false} recordingPrice={selected}
        onReviewChange={setReview} onSave={() => {}} saveBlocked={blocked}
        barcodeReview={<PhotoBarcodeReview result={{ status: 'empty' }} value={value} confirmed={checked} busy={false}
          confirmLabel={state === 'unavailable' ? 'Retry barcode lookup' : undefined}
          error={state === 'unavailable' ? 'Could not check this barcode. Try again.' : undefined}
          onChange={next => { setValue(next); setState('ready'); }} onConfirm={() => setState('matching')}
          onClear={() => { setValue(''); setState('ready'); setSelected(false); }}>
          {state === 'matching' ? <PhotoBarcodeCatalogMatch name="Example Rice" details="Dry rice · 500 g" selected={selected} busy={false}
            onUse={() => { setSelected(true); setReview(current => ({ ...current, productName: 'Example Rice' })); }}
            onCompare={() => {}} /> : state === 'missing' ? <PhotoBarcodeMissing /> : null}
        </PhotoBarcodeReview>} />
    </SafeAreaProvider>
  </View>;
}

export const FindAndUseExistingProduct: Story = {
  render: () => <CatalogReviewExample />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm barcode' }));
    await expect(canvas.getByText('Matching saved product')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Compare saved prices' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Save on this phone' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Use this product' }));
    await expect(canvas.getByText('Using saved product')).toBeVisible();
    await expect(canvas.getByLabelText('Pack price')).toHaveValue('2.50');
    await expect(canvas.getByRole('button', { name: 'Save Price' })).toBeEnabled();
  },
};

export const ExistingProductMatch: Story = { render: () => <CatalogReviewExample initial="matching" /> };
export const CatalogUnavailable: Story = { render: () => <CatalogReviewExample initial="unavailable" /> };
export const CatalogMiss: Story = { render: () => <CatalogReviewExample initial="missing" /> };

export const ConfirmAndSave: Story = {
  render: () => <ReviewExample result={candidates} />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByLabelText('Product barcode')).toHaveValue('');
    await userEvent.click(canvas.getByRole('button', { name: 'Barcode 4006381333931' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm barcode' }));
    await expect(canvas.getByText('Barcode confirmed · 4006381333931')).toBeVisible();
    await expect(canvas.getByText('Review photo · Not saved')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Use suggested details' }));
    await expect(canvas.getByLabelText('Product name')).toHaveValue('Fresh tomatoes');
    await userEvent.click(canvas.getByRole('button', { name: 'Save Price' }));
    await expect(canvas.getByText('On this phone')).toBeVisible();
  },
};

export const ManualEntry: Story = {
  render: () => <ReviewExample result={{ status: 'empty' }} />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('No product barcode found in the photo.')).toBeVisible();
    await userEvent.type(canvas.getByLabelText('Product barcode'), '0036000291452');
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm barcode' }));
    await expect(canvas.getByText('Barcode confirmed · 0036000291452')).toBeVisible();
  },
};

export const ExistingProductConflict: Story = { render: () => <ReviewExample result={candidates} conflict /> };

export const LiveScanAvailable: Story = { render: () => <ReviewExample result={{ status: 'empty' }} /> };

export const LiveScanFallback: Story = {
  render: () => <ReviewExample result={{ status: 'empty' }} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const modal = within(canvasElement.ownerDocument.body);
    await userEvent.type(canvas.getByLabelText('Product barcode'), '0036000291452');
    await userEvent.click(canvas.getByRole('button', { name: 'Scan barcode' }));
    await userEvent.click(await modal.findByRole('button', { name: 'Cancel scan' }));
    await expect(canvas.getByLabelText('Product barcode')).toHaveValue('0036000291452');

    await userEvent.click(canvas.getByRole('button', { name: 'Scan barcode' }));
    await userEvent.click(await modal.findByRole('button', { name: 'Read example barcode' }));
    await expect(canvas.getByLabelText('Product barcode')).toHaveValue('5449000152473');
    await expect(canvas.getByRole('button', { name: 'Confirm barcode' })).toBeEnabled();
    await expect(canvas.getByText('Review photo · Not saved')).toBeVisible();
  },
};

export const SavedBarcode: Story = {
  render: () => <ReviewExample savedBarcode="00036000291452" productName="Example tomatoes" />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByText('00036000291452')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Confirm barcode' })).not.toBeInTheDocument();
    await userEvent.type(canvas.getByLabelText('Pack price'), '2.50');
    await expect(canvas.getByRole('button', { name: 'Save Price' })).toBeEnabled();
  },
};

function AddProductFromPhoto() {
  const barcode = '00036000291452';
  const [productName, setProductName] = useState<string>();
  if (productName !== undefined) {
    return <ReviewExample carriedBarcode={barcode} productName={productName} result={{ status: 'empty' }} />;
  }
  return <View style={{ height: 740, width: '100%', maxWidth: 428 }}>
    <AddBarcodeProduct barcode={barcode} busy={false} onSave={() => {}} onCancel={() => {}}
      onPhoto={details => setProductName(details.productName)} />
  </View>;
}

export const CarriedBarcode: Story = {
  render: () => <AddProductFromPhoto />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText('Product name'), 'Example tomatoes');
    await userEvent.click(canvas.getByRole('button', { name: 'Add product and price from photo' }));
    await expect(canvas.getByLabelText('Product name')).toHaveValue('Example tomatoes');
    await expect(canvas.getByLabelText('Product barcode')).toHaveValue('00036000291452');
    await expect(canvas.getByRole('button', { name: 'Confirm barcode' })).toBeEnabled();
    await expect(canvas.getByText('Review photo · Not saved')).toBeVisible();
  },
};
