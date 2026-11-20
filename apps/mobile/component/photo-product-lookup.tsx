import type { Product } from '@cheapo/domain';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PhotoAsset } from '@/data/local-photo';
import type { PhotoBarcodeResult } from '@/data/photo-barcode';
import { canonicalProductBarcode } from '@/data/product-barcode';
import { CameraActionButton } from './camera-actions';
import { PhotoBarcodeMissing, PhotoBarcodeReview } from './photo-barcode-review';
import { ProductCandidateLookup, type ProductCandidateLookupProps } from './product-candidate-lookup';
import { color, spacing, ui } from './results/theme';

type Check = { kind: 'entry' } | { kind: 'checking' } | { kind: 'invalid' } | { kind: 'unavailable' }
  | { kind: 'missing' } | { kind: 'known'; barcode: string; product: Product };

export type ProductPhotoLookupProps = {
  photo: PhotoAsset;
  decoded?: PhotoBarcodeResult;
  findProduct: (barcode: string, signal: AbortSignal) => Promise<Product | undefined>;
  onCompare: (barcode: string, product: Product) => void;
  onRetake: () => void;
  candidateLookup?: ProductCandidateLookupProps;
};

export function PhotoProductLookup({ photo, decoded, findProduct, onCompare, onRetake, candidateLookup }: ProductPhotoLookupProps) {
  const [value, setValue] = useState('');
  const [check, setCheck] = useState<Check>({ kind: 'entry' });
  const interacted = useRef(false);
  const work = useRef<AbortController | null>(null);

  useEffect(() => {
    setCheck({ kind: 'entry' });
    return () => work.current?.abort();
  }, [findProduct]);

  const checkBarcode = useCallback(async (input: string) => {
    interacted.current = true;
    const barcode = canonicalProductBarcode(input);
    if (!barcode) { setCheck({ kind: 'invalid' }); return; }
    Keyboard.dismiss();
    work.current?.abort();
    const controller = new AbortController();
    work.current = controller;
    setValue(input.trim());
    setCheck({ kind: 'checking' });
    let product: Product | undefined;
    try {
      product = await findProduct(barcode, controller.signal);
    } catch {
      if (!controller.signal.aborted) setCheck({ kind: 'unavailable' });
      return;
    }
    if (controller.signal.aborted) return;
    if (!product) { setCheck({ kind: 'missing' }); return; }
    setCheck({ kind: 'known', barcode, product });
    onCompare(barcode, product);
  }, [findProduct, onCompare]);

  useEffect(() => {
    if (!interacted.current && decoded?.status === 'found' && decoded.codes.length === 1) {
      void checkBarcode(decoded.codes[0]);
    }
  }, [checkBarcode, decoded]);

  function changeBarcode(next: string) {
    interacted.current = true;
    work.current?.abort();
    setValue(next);
    setCheck({ kind: 'entry' });
  }

  const error = check.kind === 'invalid' ? 'Enter a valid product barcode.'
    : check.kind === 'unavailable' ? 'Could not check this barcode. Try again.' : undefined;
  const showCandidateLookup = check.kind !== 'known' && check.kind !== 'checking';

  return <View style={ui.page}>
    <ScrollView style={ui.page} contentContainerStyle={ui.content} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
      <Image accessibilityLabel="Product photo" source={{ uri: photo.uri }} resizeMode="contain" style={styles.photo} />
      <PhotoBarcodeReview result={decoded} value={value} confirmed={check.kind === 'known' || check.kind === 'missing'}
        busy={false} checking={check.kind === 'checking'} confirmLabel={check.kind === 'unavailable' ? 'Retry barcode lookup' : 'Find product'}
        confirmedLabel="Barcode checked" error={error} onChange={changeBarcode} onClear={() => changeBarcode('')}
        onConfirm={() => { void checkBarcode(value); }}>
        {check.kind === 'missing' ? <PhotoBarcodeMissing /> : null}
        {check.kind === 'known' ? <View style={styles.result}>
          <Text style={ui.small}>Matching saved product</Text>
          <Text accessibilityRole="header" style={ui.title}>{check.product.name}</Text>
          <CameraActionButton primary label="Compare saved prices" onPress={() => onCompare(check.barcode, check.product)} />
        </View> : null}
      </PhotoBarcodeReview>
      {candidateLookup ? <View style={showCandidateLookup ? undefined : styles.hidden}>
        <ProductCandidateLookup {...candidateLookup}
          renderIdentitySuggestions={showCandidateLookup ? candidateLookup.renderIdentitySuggestions : undefined} />
      </View> : null}
    </ScrollView>
    <SafeAreaView edges={['bottom']} style={styles.actions}>
      <CameraActionButton label="Retake photo" onPress={onRetake} />
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 220, backgroundColor: color.mint, borderRadius: 12 },
  result: { gap: spacing.sm },
  actions: { padding: spacing.md, borderTopWidth: 1, borderColor: color.line },
  hidden: { display: 'none' },
});
