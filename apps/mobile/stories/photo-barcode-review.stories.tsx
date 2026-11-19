import { useState } from 'react';
import { Modal, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Meta, StoryObj } from '@storybook/react-native-web-vite';
import { expect, within } from 'storybook/test';

import { CameraActionButton } from '../component/camera-actions';
import { PhotoBarcodeReview } from '../component/photo-barcode-review';
import { PhotoReview } from '../component/photo-review';
import type { AiPriceDraft } from '../data/ai-observation';
import type { PhotoBarcodeResult } from '../data/photo-barcode';
import { applyPhotoSuggestion, emptyReview } from '../data/photo-review';
import { canonicalProductBarcode } from '../data/product-barcode';

const meta = { title: 'Screens/Photo barcode review' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const candidates: PhotoBarcodeResult = { status: 'found', codes: ['0036000291452', '4006381333931'] };
const suggestion: AiPriceDraft = {
  product: 'Fresh tomatoes', productType: 'Tomatoes', price: 2.5, currency: 'GBP',
  packSize: '500 g', unit_price: null, uncertainty: '',
};

function ReviewExample({ result, conflict = false }: { result?: PhotoBarcodeResult; conflict?: boolean }) {
  const [review, setReview] = useState(() => emptyReview('Example shop'));
  const [showSuggestion, setShowSuggestion] = useState(true);
  const [value, setValue] = useState(conflict ? '4006381333931' : '');
  const [confirmed, setConfirmed] = useState(conflict);
  const [saved, setSaved] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <View style={{ height: 740, width: '100%', maxWidth: 428 }}>
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 428, height: 740 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
        <PhotoReview review={review} selectedShopName="Example shop" saved={saved} busy={false}
          onReviewChange={setReview} onSave={() => { if (!conflict || !confirmed) setSaved(true); }}
          saveError={conflict && confirmed ? 'This barcode already has a saved product. Scan it again to open that product.' : undefined}
          suggestion={showSuggestion ? { draft: suggestion, onApply: selected => {
            setReview(current => applyPhotoSuggestion(current, selected, new Set()));
            setShowSuggestion(false);
          } } : undefined}
          barcodeReview={<PhotoBarcodeReview result={result} value={value} confirmed={confirmed}
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
