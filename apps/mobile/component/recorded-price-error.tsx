import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { color, radius, spacing, typography, ui } from './results/theme';

type Props = {
  reason?: string;
  busy?: boolean;
  onRecord(reason: string): void;
  onUndo(): void;
};

export function RecordedPriceError({ reason, busy = false, onRecord, onUndo }: Props) {
  const [writingReason, setWritingReason] = useState(false);
  const [draft, setDraft] = useState('');
  if (reason) return <View style={[ui.card, styles.card]}>
    <Text style={styles.heading}>Recorded in error</Text>
    <Text style={ui.body}>{reason}</Text>
    <Text style={ui.small}>Cheapo keeps the saved details and any photos. This price is excluded from comparisons.</Text>
    <Action label="Undo recorded in error" disabled={busy} onPress={() => {
      setWritingReason(false);
      setDraft('');
      onUndo();
    }} />
  </View>;
  if (!writingReason) return <Action label="Record in error" disabled={busy} onPress={() => setWritingReason(true)} />;
  return <View style={[ui.card, styles.card]}>
    <Text style={styles.heading}>Record this price in error</Text>
    <Text style={ui.body}>Your reason stays with the saved price. You can undo this later.</Text>
    <TextInput accessibilityLabel="Reason for marking this price in error" style={styles.input}
      placeholder="For example, the price was for the wrong item" placeholderTextColor={color.muted}
      multiline value={draft} maxLength={300} editable={!busy} onChangeText={setDraft} />
    <Action label="Save reason" disabled={busy || !draft.trim()} onPress={() => { Keyboard.dismiss(); onRecord(draft.trim()); }} />
    <Action label="Cancel marking in error" disabled={busy} onPress={() => { setDraft(''); setWritingReason(false); }} />
  </View>;
}

function Action({ label, onPress, disabled }: { label: string; onPress(): void; disabled: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    style={[ui.button, styles.action, disabled && styles.disabled]} onPress={onPress}>
    <Text style={[ui.buttonText, styles.actionText]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  heading: { color: color.warningInk, fontSize: typography.card, fontWeight: '700' },
  action: { backgroundColor: color.mint },
  actionText: { color: color.green },
  disabled: { opacity: 0.5 },
  input: { borderColor: color.line, borderWidth: 1, backgroundColor: color.white, color: color.ink,
    borderRadius: radius.control, padding: spacing.md, minHeight: 74, textAlignVertical: 'top' },
});
