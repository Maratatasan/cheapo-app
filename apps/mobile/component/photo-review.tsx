import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Button, Image, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ManualReview, PhotoAsset } from '@/data/local-photo';
import { reviewComplete } from '@/data/local-photo';
import { productMetadataMaxLength } from '@/data/product-metadata';

type Props = {
  photo: PhotoAsset; review: ManualReview; saved: boolean; busy: boolean;
  selectedShopName?: string;
  onReviewChange: (review: ManualReview) => void;
  onSave: () => void; onRetake: () => void; onCrop: () => void;
  galleryAction?: ReactNode; onOriginal?: () => void; onImageError: () => void; children?: ReactNode;
};

export function PhotoReview({ photo, review, selectedShopName, saved, busy, onReviewChange, onSave, onRetake, onCrop, onOriginal, onImageError, galleryAction, children }: Props) {
  const container = useRef<ComponentRef<typeof View>>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const focused = useRef<keyof ManualReview | null>(null);
  const positions = useRef<Partial<Record<keyof ManualReview, number>>>({});
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [headerOffset, setHeaderOffset] = useState(0);
  const complete = reviewComplete(review, selectedShopName);
  const revealFocused = () => {
    const y = focused.current ? positions.current[focused.current] : undefined;
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 12), animated: false });
  };
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => { setKeyboardVisible(true); });
    const hide = Keyboard.addListener('keyboardDidHide', () => { setKeyboardVisible(false); focused.current = null; });
    return () => { show.remove(); hide.remove(); };
  }, []);
  const fields = [
    ['productName', 'Product', 'Product name', 'For example rice 1kg'],
    ['productType', 'Product type (optional)', 'Product type', 'For example dry rice or microwave rice', productMetadataMaxLength],
    ['variety', 'Variety (optional)', 'Variety', 'For example basmati', productMetadataMaxLength],
    ['brand', 'Brand (optional)', 'Brand', 'For example Tilda', productMetadataMaxLength],
    ['price', `Price (${review.currency || 'GBP'})`, 'Pack price', '0.00'],
    ['currency', 'Currency', 'Currency', 'GBP'],
    ['shop', 'Shop', 'Confirmed shop', 'Shop and branch'],
    ['unitPrice', 'Unit price (optional)', 'Unit price (optional)', '0.00'],
    ['unit', 'Unit (kg / 100g / litre / each)', 'Unit (for example kg or litre)', 'For example kg'],
  ] as const;
  return <View ref={container} style={styles.root} onLayout={() => container.current?.measureInWindow((_, y) => setHeaderOffset(y))}>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerOffset}>
      <ScrollView ref={scroll} style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onContentSizeChange={revealFocused} onLayout={revealFocused}>
        {!keyboardVisible ? <Image source={{ uri: photo.uri }} accessibilityLabel="Price photo preview" style={styles.photo} resizeMode="contain" onError={onImageError} /> : null}
        <Text style={styles.status}>{saved ? 'On this phone' : 'Review photo · Not saved'}</Text>
        <Text style={styles.note}>{complete ? 'Manual details ready' : selectedShopName ? 'Incomplete draft · Add product and price' : 'Incomplete draft · Add product, price and shop'}</Text>
        <View style={styles.actions}>
          <Button title="Crop photo" disabled={busy} onPress={() => { Keyboard.dismiss(); onCrop(); }} />
          {onOriginal ? <Button title="Use original" disabled={busy} onPress={onOriginal} /> : null}
        </View>
        {children}
        {fields.map(([field, label, accessibilityLabel, placeholder, maxLength]) => <View key={field} style={styles.field} onLayout={event => { positions.current[field] = event.nativeEvent.layout.y; if (keyboardVisible && focused.current === field) revealFocused(); }}>
          <Text style={styles.label}>{label}</Text>
          {field === 'productType' ? <Text style={styles.note}>Use the same type for products you would compare. For example, use different types for fresh potatoes and frozen chips.</Text> : null}
          {field === 'shop' && selectedShopName ? <Text accessibilityLabel={`${accessibilityLabel}: ${selectedShopName}`} style={styles.input}>{selectedShopName}</Text> : (
            <TextInput accessibilityLabel={accessibilityLabel} placeholder={placeholder} placeholderTextColor="#666" value={review[field] ?? ''} maxLength={maxLength} editable={!busy} keyboardType={field === 'price' || field === 'unitPrice' ? 'decimal-pad' : 'default'} autoCapitalize={field === 'currency' ? 'characters' : 'sentences'} style={styles.input} onFocus={() => { focused.current = field; revealFocused(); }} onChangeText={value => onReviewChange({ ...review, [field]: field === 'currency' ? value.toUpperCase().slice(0, 3) : value })} />
          )}
        </View>)}
        <Text style={styles.note}>Use a decimal point for prices. {selectedShopName ? '' : 'Confirm the shop manually. '}Incomplete details are saved as a photo draft.</Text>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Button title={busy ? 'Saving…' : complete ? 'Save product' : 'Save on this phone'} disabled={busy || saved} onPress={() => { Keyboard.dismiss(); onSave(); }} />
        {saved ? galleryAction : null}
        <Button title="Retake" disabled={busy} onPress={() => { Keyboard.dismiss(); onRetake(); }} />
      </SafeAreaView>
    </KeyboardAvoidingView>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#111' }, content: { padding: 16, gap: 12 }, photo: { width: '100%', height: 250, backgroundColor: '#000' }, status: { color: '#fff', fontSize: 18, fontWeight: 'bold' }, note: { color: '#ddd', fontSize: 13 }, actions: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, field: { gap: 5 }, label: { color: '#fff', fontSize: 13, fontWeight: '600' }, input: { backgroundColor: '#fff', color: '#111', borderRadius: 8, padding: 12, minHeight: 48, fontSize: 16 }, footer: { backgroundColor: '#1a1a1a', paddingHorizontal: 16, paddingTop: 8, gap: 8, borderTopColor: '#444', borderTopWidth: 1 } });
