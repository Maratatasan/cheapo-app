import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { PhotoBarcodeResult } from '@/data/photo-barcode';
import { marketColor as color, spacing } from './results/theme';

type Props = {
  result?: PhotoBarcodeResult;
  value: string;
  confirmed: boolean;
  carried?: boolean;
  locked?: boolean;
  busy: boolean;
  error?: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onClear: () => void;
  onScan?: () => void;
};

const messages = {
  pending: 'Reading barcodes from the original photo…',
  found: 'Choose the code printed on the product packaging, or enter it manually.',
  empty: 'No product barcode found in the photo.',
  error: 'Couldn’t read barcodes from the photo.',
  unavailable: 'Photo barcode reading is unavailable.',
};

export function PhotoBarcodeReview({ result, value, confirmed, carried, locked, busy, error, onChange, onConfirm, onClear, onScan }: Props) {
  const scanButton = onScan && !locked ? (
    <Pressable accessibilityRole="button" accessibilityLabel="Scan barcode"
      disabled={busy} onPress={onScan} style={[styles.scan, busy && styles.disabled]}>
      <View style={styles.cameraIcon} pointerEvents="none">
        <View style={styles.cameraBump} />
        <View style={styles.cameraLens} />
      </View>
    </Pressable>
  ) : null;
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.label}>Product barcode</Text>
      {confirmed ? (
        <>
          <View style={styles.inputRow}>
            <Text accessibilityLiveRegion="polite" selectable style={[styles.label, styles.grow]}>
              Barcode confirmed · {value}
            </Text>
            {scanButton}
          </View>
          {locked ? null : <Pressable accessibilityRole="button" disabled={busy} onPress={onClear} style={styles.button}>
            <Text style={styles.label}>Clear barcode</Text>
          </Pressable>}
        </>
      ) : (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.note}>{carried ? 'Review the barcode from your scan.' : messages[result?.status ?? 'pending']}</Text>
          {result?.status === 'found' ? <View style={styles.choices}>
            {result.codes.map(code => (
              <Pressable key={code} accessibilityRole="button" accessibilityLabel={`Barcode ${code}`}
                accessibilityState={{ selected: code === value }} disabled={busy} onPress={() => onChange(code)}
                style={[styles.button, code === value && styles.selected]}>
                <Text style={styles.label}>{code}</Text>
              </Pressable>
            ))}
          </View> : null}
          <View style={styles.inputRow}>
            <TextInput accessibilityLabel="Product barcode" keyboardType="number-pad" maxLength={14}
              placeholder="Enter barcode manually" placeholderTextColor={color.muted}
              editable={!busy} value={value} onChangeText={onChange} style={[styles.input, styles.grow]} />
            {scanButton}
          </View>
          <Pressable accessibilityRole="button" disabled={busy || !value.trim()} onPress={onConfirm}
            style={[styles.button, (busy || !value.trim()) && styles.disabled]}>
            <Text style={styles.label}>Confirm barcode</Text>
          </Pressable>
        </>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, backgroundColor: color.surface,
    borderRadius: 12, borderColor: color.border, borderWidth: 1 },
  label: { color: color.ink, fontSize: 14, fontWeight: '700' },
  note: { color: color.muted, fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  grow: { flex: 1 },
  scan: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10,
    borderColor: color.border, borderWidth: 1, backgroundColor: color.mint },
  cameraIcon: { width: 21, height: 15, marginTop: 3, borderRadius: 4,
    borderColor: color.green, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  cameraBump: { position: 'absolute', top: -5, width: 9, height: 4, borderTopLeftRadius: 2,
    borderTopRightRadius: 2, backgroundColor: color.green },
  cameraLens: { width: 7, height: 7, borderRadius: 4, borderColor: color.green, borderWidth: 2 },
  input: { minHeight: 44, padding: spacing.sm, borderRadius: 10, borderColor: color.border, borderWidth: 1,
    color: color.ink, fontSize: 16, fontVariant: ['tabular-nums'] },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md,
    borderRadius: 10, backgroundColor: color.mint, borderColor: color.mint, borderWidth: 1 },
  selected: { borderColor: color.green },
  disabled: { opacity: 0.6 },
  error: { color: color.orange, fontSize: 13 },
});
