import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { normalizeName } from '@cheapo/domain/names';
import type { Product } from '@cheapo/domain';
import { packSizeMaxLength, productPackFromText } from '@/data/photo-review';
import { productMetadataMaxLength } from '@/data/product-metadata';
import { color, radius, spacing, typography, ui } from './results/theme';

export type BarcodeProductDetails = Omit<Product, 'id' | 'barcode'>;
const fields = [
  ['name', 'Product name', 'For example basmati rice', 200],
  ['productType', 'Product type', 'For example dry rice', productMetadataMaxLength],
  ['variety', 'Variety (optional)', 'For example basmati', productMetadataMaxLength],
  ['brand', 'Brand (optional)', 'For example Example brand', productMetadataMaxLength],
  ['pack', 'Pack size (optional)', 'For example 500 g or 8 × 500 mL', packSizeMaxLength],
] as const;

export function AddBarcodeProduct({ barcode, busy, error, onSave, onCancel }: {
  barcode: string;
  busy: boolean;
  error?: string;
  onSave: (details: BarcodeProductDetails) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState({ name: '', productType: '', variety: '', brand: '', pack: '' });
  const [attempted, setAttempted] = useState(false);
  const name = normalizeName(values.name);
  const productType = normalizeName(values.productType);
  const pack = productPackFromText(values.pack);
  const invalidPack = !!values.pack.trim() && !pack;
  const validation = !name || !productType ? 'Enter a product name and type.' :
    invalidPack ? 'Enter a pack quantity and unit, or clear the pack size.' : undefined;
  const feedback = attempted && validation ? validation : error;

  function submit() {
    setAttempted(true);
    if (!name || !productType || validation) return;
    Keyboard.dismiss();
    onSave({ name, productType, variety: normalizeName(values.variety), brand: normalizeName(values.brand), pack });
  }

  return (
    <ScrollView style={ui.page} contentContainerStyle={ui.content} automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text accessibilityRole="header" style={ui.title}>Add product</Text>
      <Text style={ui.body} selectable>Barcode {barcode}</Text>
      {fields.map(([key, label, placeholder, maxLength]) => (
        <View key={key} style={styles.field}>
          <Text style={styles.label}>{label}</Text>
          <TextInput accessibilityLabel={label} value={values[key]} editable={!busy} maxLength={maxLength}
            placeholder={placeholder} placeholderTextColor={color.muted} style={styles.input}
            onChangeText={text => setValues(current => ({ ...current, [key]: text }))} />
        </View>
      ))}
      {feedback ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{feedback}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ busy, disabled: busy }}
        disabled={busy} onPress={submit} style={[ui.button, busy && styles.disabled]}>
        <Text style={ui.buttonText}>{busy ? 'Saving product…' : 'Save product'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => { Keyboard.dismiss(); onCancel(); }}
        style={[ui.button, styles.cancel, busy && styles.disabled]}>
        <Text style={styles.label}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { color: color.ink, fontSize: typography.label, fontWeight: '600' },
  input: { minHeight: 48, backgroundColor: color.white, borderColor: color.line, borderWidth: 1,
    borderRadius: radius.control, padding: spacing.md, color: color.ink, fontSize: typography.label },
  error: { color: '#A22A23', fontSize: typography.body },
  cancel: { backgroundColor: color.mint },
  disabled: { opacity: 0.65 },
});
