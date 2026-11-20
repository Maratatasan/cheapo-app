import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ConflictValues, ShoppingConflict } from '../data/shopping-conflict';
import { color, spacing, typography, ui } from './results/theme';

type Props = {
  conflict: ShoppingConflict;
  busy?: boolean;
  error?: string;
  bottomInset?: number;
  onKeepPhone(): void;
  onKeepCloud(laterIds: string[]): void;
  onClose(): void;
};

export function ShoppingConflictReview({ conflict, busy = false, error, bottomInset = 0, onKeepPhone, onKeepCloud, onClose }: Props) {
  const [confirmCloud, setConfirmCloud] = useState(false);
  const { title, phone, cloud, laterEdits } = conflict;
  return <View style={ui.page}>
    <ScrollView style={ui.page} contentContainerStyle={[ui.content, styles.content]}>
      <Text accessibilityRole="header" style={ui.title}>{confirmCloud ? 'Keep the cloud version?' : 'Conflicting changes'}</Text>
      <Text style={styles.record}>{title}</Text>
      {confirmCloud ? <View style={[ui.card, styles.content]}>
        <Text accessibilityLiveRegion="polite" style={ui.body}>The phone version will be kept for recovery.</Text>
        {laterEdits.length ? <>
          <Text style={ui.body}>{laterEdits.length} {laterEdits.length === 1 ? 'later edit will' : 'later edits will'} also be set aside and kept for recovery.</Text>
          {laterEdits.map(edit => <Text key={edit.id} style={ui.body}>{edit.title}</Text>)}
        </> : null}
      </View> : <>
        <Text style={ui.body}>Choose which version to keep for this record.</Text>
        <View style={styles.versions}>
          <Version title="On this phone" values={phone} />
          <Version title="In the cloud" values={cloud} />
        </View>
      </>}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
    <View style={[styles.footer, { paddingBottom: spacing.md + bottomInset }]}>
      {confirmCloud ? <>
        <Choice label="Confirm keep cloud" onPress={() => onKeepCloud(laterEdits.map(({ id }) => id))} busy={busy} />
        <Choice label="Back to versions" secondary onPress={() => setConfirmCloud(false)} busy={busy} />
      </> : <>
        <Choice label="Keep phone" onPress={onKeepPhone} busy={busy} />
        <Choice label="Keep cloud" secondary onPress={() => setConfirmCloud(true)} busy={busy} />
        <Choice label="Back to Pending sync" secondary onPress={onClose} busy={busy} />
      </>}
    </View>
  </View>;
}

function Version({ title, values }: { title: string; values: ConflictValues }) {
  return <View style={[ui.card, styles.version]}>
    <Text accessibilityRole="header" style={styles.record}>{title}</Text>
    {values.map(({ label, value }) => <View key={label} style={styles.field}>
      <Text style={ui.small}>{label}</Text>
      <Text style={ui.body}>{value}</Text>
    </View>)}
  </View>;
}

function Choice({ label, busy, onPress, secondary }: { label: string; busy: boolean; onPress(): void; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ busy, disabled: busy }}
    onPress={onPress} style={[ui.button, secondary && styles.secondary, busy && styles.disabled]}>
    <Text style={[ui.buttonText, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  record: { fontSize: typography.card, fontWeight: '700', color: color.ink },
  versions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', alignItems: 'flex-start' },
  version: { flex: 1, minWidth: 142, gap: spacing.sm },
  field: { gap: spacing.xs },
  footer: { width: '100%', maxWidth: 696, alignSelf: 'center', padding: spacing.md, gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  secondary: { backgroundColor: color.mint },
  secondaryText: { color: color.green },
  disabled: { opacity: 0.5 },
  error: { color: color.warningInk },
});
