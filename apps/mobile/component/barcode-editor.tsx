import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { marketColor, spacing, typography, ui } from './results/theme';

export type BarcodeEditorProps = {
  current: string;
  productName?: string;
  proposed?: string;
  manual: boolean;
  busy?: boolean;
  error?: string;
  onScan: () => void;
  onManual: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function BarcodeEditor({ current, productName, proposed, manual, busy, error,
  onScan, onManual, onChange, onSave, onCancel }: BarcodeEditorProps) {
  return (
    <View style={ui.page}>
      <ScrollView contentContainerStyle={ui.content} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={ui.title}>{productName ? 'Edit saved barcode' : 'Correct lookup code'}</Text>
        {productName ? <Text style={ui.body}>{productName}</Text> : null}
        <Text style={ui.body} selectable>Current barcode {current}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onScan} style={styles.secondary}>
          <Text style={styles.label}>Scan barcode</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onManual} style={styles.secondary}>
          <Text style={styles.label}>Enter manually</Text>
        </Pressable>
        {manual ? (
          <TextInput accessibilityLabel="Proposed barcode" keyboardType="number-pad" maxLength={14}
            style={styles.input} value={proposed ?? ''} editable={!busy} onChangeText={onChange} />
        ) : proposed ? <Text style={ui.body} selectable>Proposed barcode {proposed}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={ui.body}>{error}</Text> : null}
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable accessibilityRole="button" disabled={!proposed || busy} onPress={onSave}
          style={[ui.button, (!proposed || busy) && styles.disabled]}>
          <Text style={ui.buttonText}>{busy ? 'Saving…' : productName ? 'Save barcode' : 'Look up barcode'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.secondary}>
          <Text style={styles.label}>Cancel</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

export function BarcodeResultActions({ barcode, onLookup, onEdit }: {
  barcode: string; onLookup: () => void; onEdit?: () => void;
}) {
  return (
    <View style={ui.card}>
      <View style={styles.barcode}>
        <Text style={ui.body} selectable>Barcode {barcode}</Text>
        {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Edit barcode" onPress={onEdit} style={styles.icon}>
          <Text style={styles.label}>✎</Text>
        </Pressable> : null}
      </View>
      <Pressable accessibilityRole="button" onPress={onLookup} style={styles.secondary}>
        <Text style={styles.label}>Correct lookup code</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  barcode: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  icon: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: marketColor.mint, borderRadius: 12 },
  label: { color: marketColor.ink, fontSize: typography.label, fontWeight: '700' },
  input: { minHeight: 48, padding: spacing.md, backgroundColor: marketColor.surface, borderRadius: 12,
    borderWidth: 1, borderColor: marketColor.border, color: marketColor.ink, fontSize: typography.label },
  footer: { padding: spacing.md, gap: spacing.sm, backgroundColor: marketColor.background },
  disabled: { opacity: 0.6 },
});
