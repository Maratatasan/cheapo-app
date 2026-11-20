import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
import type { Product } from '@cheapo/domain';

import type { LocalPhotoDraft, linkSavedPriceToBarcode } from '@/data/local-photo';
import type { PhotoBarcodeResult } from '@/data/photo-barcode';
import { savedProductDetails, type ManualReview } from '@/data/photo-review';
import { canonicalProductBarcode } from '@/data/product-barcode';
import { CameraActionButton } from './camera-actions';
import { PhotoBarcodeReview } from './photo-barcode-review';
import { marketColor as color, spacing, typography } from './results/theme';

type ScanCallbacks = { onCancel: () => void; onRead: (code: string) => void; onError: (message: string) => void };
type Match = { code: string; product?: Product };

type Props = {
  record: Pick<LocalPhotoDraft, 'id'> & { review: ManualReview; original?: LocalPhotoDraft['original'] };
  lookup: (code: string) => Promise<Product | undefined>;
  readPhoto?: (uri: string) => Promise<PhotoBarcodeResult>;
  renderScanner?: (callbacks: ScanCallbacks) => ReactNode;
  link: (...args: Parameters<typeof linkSavedPriceToBarcode>) => Promise<{ product: Product }>;
  disabled?: boolean;
  onSavingChange?: (saving: boolean) => void;
  onLinked: (code: string) => void;
  onCancel: () => void;
};

export function SavedPriceBarcode({ record, lookup, readPhoto, renderScanner, link, disabled, onSavingChange, onLinked, onCancel }: Props) {
  const [value, setValue] = useState('');
  const [match, setMatch] = useState<Match>();
  const [detected, setDetected] = useState<PhotoBarcodeResult>();
  const [error, setError] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const pending = useRef(false);
  const details = savedProductDetails(record.review);
  const target = match?.product ?? details;
  const pack = target.pack?.label ?? (target.pack && `${target.pack.quantity} ${target.pack.unit}`);
  const productDescription = [target.productType, target.brand, target.variety, pack].filter(Boolean).join(' · ');
  const original = record.original?.uri;

  useEffect(() => {
    active.current = true;
    let cancelled = false;
    setDetected(undefined);
    if (readPhoto && original) void readPhoto(original).then(result => {
      if (!cancelled) setDetected(result);
    }).catch(() => {
      if (!cancelled) setDetected({ status: 'error' });
    });
    return () => { cancelled = true; active.current = false; };
  }, [readPhoto, original]);

  function change(code: string) {
    setValue(code); setError(undefined); setMatch(undefined);
  }

  async function confirm() {
    if (disabled || pending.current) return;
    const code = canonicalProductBarcode(value);
    if (!code) { setError('Enter a valid product barcode.'); return; }
    Keyboard.dismiss();
    pending.current = true;
    setBusy(true); setError(undefined);
    try {
      const product = await lookup(code);
      if (active.current) setMatch({ code, product });
    } catch {
      if (active.current) setError('Could not check this barcode. Try again.');
    } finally {
      pending.current = false;
      if (active.current) setBusy(false);
    }
  }

  async function save() {
    if (disabled || pending.current || !match) return;
    pending.current = true;
    setBusy(true); setError(undefined);
    onSavingChange?.(true);
    try {
      const { product } = await link(record.id, match.code, match.product
        ? { kind: 'existing', productId: match.product.id }
        : { kind: 'new', details });
      if (active.current) onLinked(product.barcode ?? match.code);
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : 'Could not link the barcode. Try again.');
    } finally {
      pending.current = false;
      if (active.current) {
        setBusy(false);
        onSavingChange?.(false);
      }
    }
  }

  const locked = busy || disabled;
  return <View style={styles.panel}>
    <PhotoBarcodeReview result={detected ?? (readPhoto && original ? undefined : { status: 'unavailable' })} value={value}
      confirmed={Boolean(match)} confirmLabel="Check barcode" confirmedLabel="Barcode checked" busy={Boolean(locked)} error={error} onChange={change}
      onConfirm={() => { void confirm(); }} onClear={() => change('')}
      onScan={renderScanner ? () => setScanning(true) : undefined} />
    {match ? <View style={styles.target}>
      <Text style={styles.title}>{match.product ? 'Matching saved product' : 'New product from saved details'}</Text>
      <Text style={styles.title}>{target.name}</Text>
      {productDescription ? <Text style={styles.note}>{productDescription}</Text> : null}
      {!match.product && !details.productType?.trim() ? (
        <Text style={styles.note}>Save a product type on this price before creating the product.</Text>
      ) : null}
      <CameraActionButton primary label={match.product ? 'Save barcode link' : 'Create product and link'}
        disabled={locked || (!match.product && !details.productType?.trim())} busy={busy} onPress={() => { void save(); }} />
    </View> : null}
    <CameraActionButton label="Cancel barcode link" disabled={locked} onPress={onCancel} />
    {scanning ? renderScanner?.({
      onCancel: () => setScanning(false),
      onRead: code => { change(code); setScanning(false); },
      onError: message => { setError(message); setScanning(false); },
    }) : null}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: spacing.sm },
  target: { gap: spacing.xs },
  title: { color: color.ink, fontSize: typography.label, fontWeight: '700' },
  note: { color: color.muted, fontSize: typography.label },
});
