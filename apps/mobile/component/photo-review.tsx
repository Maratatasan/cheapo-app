import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Button, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PhotoAsset } from '@/data/local-photo';
import { calculatePackUnitPrice, packSizeMaxLength, reviewComplete, reviewUnitPrice, type ManualReview } from '@/data/photo-review';
import { productMetadataMaxLength } from '@/data/product-metadata';
import { unitPriceLabel } from '@/data/observation';
import { marketColor as color } from './results/theme';

type Props = {
  photo?: PhotoAsset; review: ManualReview; saved: boolean; busy: boolean;
  selectedShopName?: string;
  onReviewChange: (review: ManualReview) => void;
  onSave: () => void; onRetake?: () => void; onCrop?: () => void; onCancel?: () => void;
  galleryAction?: ReactNode; onOriginal?: () => void; onImageError?: () => void; children?: ReactNode;
  saveError?: string;
  recordingPrice?: boolean;
};

export function PhotoReview({ photo, review, selectedShopName, saved, busy, onReviewChange, onSave, onRetake, onCrop, onCancel, onOriginal, onImageError, galleryAction, children, saveError, recordingPrice }: Props) {
  const container = useRef<ComponentRef<typeof View>>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const focused = useRef<keyof ManualReview | null>(null);
  const positions = useRef<Partial<Record<keyof ManualReview, number>>>({});
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [headerOffset, setHeaderOffset] = useState(0);
  const complete = reviewComplete(review, selectedShopName);
  const editing = !!onCancel && !recordingPrice;
  const requireComplete = editing || recordingPrice;
  const revealFocused = () => {
    const y = focused.current ? positions.current[focused.current] : undefined;
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: false });
  };
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => { setKeyboardVisible(true); });
    const hide = Keyboard.addListener('keyboardDidHide', () => { setKeyboardVisible(false); focused.current = null; });
    return () => { show.remove(); hide.remove(); };
  }, []);
  const product = ['productName', 'Product', 'Product name', 'For example rice 1kg'] as const;
  const metadata = [
    ['productType', 'Product type (optional)', 'Product type', 'For example dry rice or microwave rice', productMetadataMaxLength],
    ['variety', 'Variety (optional)', 'Variety', 'For example basmati', productMetadataMaxLength],
    ['brand', 'Brand (optional)', 'Brand', 'For example Tilda', productMetadataMaxLength],
  ] as const;
  const pack = ['packSize', 'Pack size (optional)', 'Pack size', 'For example 500 g or 8 × 500 ml', packSizeMaxLength] as const;
  const price = [
    ['price', `Total price (${review.currency || 'GBP'})`, 'Pack price', '0.00'],
    ['currency', 'Currency', 'Currency', 'GBP'],
  ] as const;
  const shop = ['shop', 'Shop', 'Confirmed shop', 'Shop and branch'] as const;
  const unitPrice = [
    ['unitPrice', 'Unit price (optional)', 'Unit price (optional)', '0.00'],
    ['unit', 'Unit (kg / 100g / litre / each)', 'Unit (for example kg or litre)', 'For example kg'],
  ] as const;
  const fields = recordingPrice ? [...price, pack, ...unitPrice, shop] : editing
    ? [product, pack, ...price, ...unitPrice, ...metadata, shop]
    : [product, ...metadata, pack, ...price, shop, ...unitPrice];
  const amount = reviewUnitPrice(review);
  const invalidPack = !!review.packSize?.trim() && !calculatePackUnitPrice('1', review.packSize);
  const saveLabel = busy ? 'Saving…' : editing ? 'Save changes' : recordingPrice || complete ? 'Save Price' : 'Save on this phone';
  return <View ref={container} style={styles.root} onLayout={() => container.current?.measureInWindow((_, y) => setHeaderOffset(y))}>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerOffset}>
      <ScrollView ref={scroll} style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onContentSizeChange={revealFocused} onLayout={revealFocused}>
        {photo && !keyboardVisible ? <Image source={{ uri: photo.uri }} accessibilityLabel="Price photo preview" style={styles.photo} resizeMode="contain" onError={onImageError} /> : null}
        <Text style={styles.status}>{recordingPrice ? review.productName : editing ? 'Review saved details' : saved ? 'On this phone' : 'Review photo · Not saved'}</Text>
        <Text style={styles.note}>{recordingPrice ? 'Review the current price before saving.' : editing ? 'Use the amount and unit from your saved observation. Enter both unit-price fields or leave both blank.' : complete ? 'Manual details ready' : selectedShopName ? 'Incomplete draft · Add product and price' : 'Incomplete draft · Add product, price and shop'}</Text>
        {onCrop ? <View style={styles.actions}>
          <Button title="Crop photo" disabled={busy} onPress={() => { Keyboard.dismiss(); onCrop(); }} />
          {onOriginal ? <Button title="Use original" disabled={busy} onPress={onOriginal} /> : null}
        </View> : null}
        {children}
        {fields.map(([field, label, accessibilityLabel, placeholder, maxLength]) => <View key={field} style={styles.field} onLayout={event => { positions.current[field] = event.nativeEvent.layout.y; if (keyboardVisible && focused.current === field) revealFocused(); }}>
          <Text style={styles.label}>{label}</Text>
          {field === 'packSize' && invalidPack ? <Text style={styles.note}>Enter the quantity and unit. For multipacks, include the count and size of each pack, for example 8 × 500 ml.</Text> : null}
          {field === 'productType' ? <Text style={styles.note}>Use the same type for products you would compare. For example, use different types for fresh potatoes and frozen chips.</Text> : null}
          {field === 'shop' && selectedShopName ? <Text accessibilityLabel={`${accessibilityLabel}: ${selectedShopName}`} style={styles.input}>{selectedShopName}</Text> : (
            <TextInput accessibilityLabel={accessibilityLabel} placeholder={placeholder} placeholderTextColor="#666" value={review[field] ?? ''} maxLength={maxLength} editable={!busy} keyboardType={field === 'price' || field === 'unitPrice' ? 'decimal-pad' : 'default'} autoCapitalize={field === 'currency' ? 'characters' : 'sentences'} style={styles.input} onFocus={() => { focused.current = field; revealFocused(); }} onChangeText={value => onReviewChange({ ...review, [field]: field === 'currency' ? value.toUpperCase().slice(0, 3) : value })} />
          )}
          {field === 'price' && amount ? (
            <View style={styles.unitSummary}>
              <Text style={styles.label}>{review.unitPrice.trim() ? 'Unit price' : 'Calculated unit price'}</Text>
              <Text style={styles.unitValue}>{unitPriceLabel({ unit_price: amount, currency: review.currency })}</Text>
            </View>
          ) : null}
        </View>)}
        <Text style={styles.note}>Use a decimal point for prices. {requireComplete ? '' : `${selectedShopName ? '' : 'Confirm the shop manually. '}Incomplete details are saved as a photo draft.`}</Text>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        {saveError ? <Text accessibilityRole="alert" style={styles.note}>{saveError}</Text> : null}
        {requireComplete && !complete ? <Text accessibilityLiveRegion="polite" style={styles.note}>{recordingPrice ? 'Enter a valid price to save.' : 'Enter a product and valid price details to save.'}</Text> : null}
        <Pressable accessibilityRole="button" disabled={busy || saved || (requireComplete && !complete)} onPress={() => { Keyboard.dismiss(); onSave(); }}
          style={[styles.save, (busy || saved || (requireComplete && !complete)) && styles.disabled]}><Text style={styles.saveText}>{saveLabel}</Text></Pressable>
        {saved ? galleryAction : null}
        {onCancel ? <Button title="Cancel" disabled={busy} onPress={() => { Keyboard.dismiss(); onCancel(); }} /> : null}
        {onRetake ? <Button title="Retake" disabled={busy} onPress={() => { Keyboard.dismiss(); onRetake(); }} /> : null}
      </SafeAreaView>
    </KeyboardAvoidingView>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.background },
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', padding: 18, gap: 12 },
  photo: { width: '100%', height: 210, borderRadius: 12, backgroundColor: color.mint },
  status: { color: color.ink, fontSize: 21, fontWeight: '700' },
  note: { color: color.muted, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  field: { gap: 4 },
  label: { color: color.ink, fontSize: 14, fontWeight: '700' },
  input: { backgroundColor: color.surface, color: color.ink, borderColor: color.border, borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 44, fontSize: 16 },
  unitSummary: { backgroundColor: color.mint, borderRadius: 12, padding: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  unitValue: { color: color.ink, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
  footer: { backgroundColor: color.background, paddingHorizontal: 18, paddingTop: 8, gap: 8, borderTopColor: color.border, borderTopWidth: 1 },
  save: { minHeight: 48, borderRadius: 12, backgroundColor: color.green, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.65 },
  saveText: { color: color.surface, fontWeight: '700', fontSize: 16 },
});
