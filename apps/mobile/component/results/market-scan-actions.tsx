import { Pressable, StyleSheet, Text, View } from 'react-native';
import { marketColor, spacing } from './theme';

export function MarketScanActions({ onScanLabel }: { onScanLabel: () => void }) {
  return (
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" onPress={onScanLabel} style={[styles.button, styles.label]}>
        <Text style={styles.labelText}>Scan label</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Scan product barcode, coming next" accessibilityState={{ disabled: true }} disabled style={styles.button}>
        <Text style={styles.barcodeText}>Scan product barcode</Text>
        <Text style={styles.caption}>Coming next</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 18, paddingVertical: spacing.sm },
  button: { flex: 1, minHeight: 52, padding: spacing.xs, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: marketColor.border, backgroundColor: marketColor.surface },
  label: { backgroundColor: marketColor.orange, borderColor: marketColor.marigold },
  labelText: { color: marketColor.surface, fontSize: 15, fontWeight: '700' },
  barcodeText: { textAlign: 'center', color: marketColor.muted, fontSize: 15, fontWeight: '600' },
  caption: { color: marketColor.muted, fontSize: 12 },
});
