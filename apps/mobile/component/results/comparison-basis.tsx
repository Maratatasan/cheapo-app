import type { PackagePriceBasis } from '@cheapo/domain';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { marketColor as color, spacing, typography } from './theme';

const labels: Record<PackagePriceBasis, string> = {
  kg: 'Per kg', '100g': 'Per 100 g', litre: 'Per litre', '100mL': 'Per 100 mL', item: 'Per item', wash: 'Per wash',
};

export type ComparisonBasisPreference = {
  basis: PackagePriceBasis | null;
  checked: boolean;
  loading: boolean;
  saving: boolean;
  lastSyncedAt?: string;
  error?: string;
  choose: (basis: PackagePriceBasis | null) => Promise<void>;
};

export function ComparisonBasis({ preference, available }: {
  preference: ComparisonBasisPreference;
  available: readonly PackagePriceBasis[];
}) {
  const { basis, checked, loading, saving, lastSyncedAt, error, choose } = preference;
  const choices = [null, ...available];
  return (
    <View style={styles.layout}>
      <Text style={styles.title}>Compare by</Text>
      {checked ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Comparison basis" style={styles.options}>
          {choices.map(choice => (
            <Pressable key={choice ?? 'automatic'} accessibilityRole="radio" disabled={saving}
              aria-checked={basis === choice}
              accessibilityState={{ checked: basis === choice, disabled: saving }}
              onPress={() => { void choose(choice); }} style={[styles.option, basis === choice && styles.selected]}>
              <Text style={styles.label}>{choice ? labels[choice] : 'Automatic'}</Text>
            </Pressable>
          ))}
        </View>
      ) : <Text style={styles.note}>{loading ? 'Checking your comparison preference…' : 'Comparison preference unavailable offline.'}</Text>}
      {basis && !available.includes(basis) ? (
        <Text style={styles.note}>Your choice is {labels[basis].toLowerCase()}. These prices have no confirmed rate on that basis.</Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.note}>{error}</Text> : null}
      {lastSyncedAt ? <Text style={styles.note}>Preference last synced {new Date(lastSyncedAt).toLocaleString()}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layout: { gap: spacing.xs },
  title: { color: color.ink, fontSize: typography.body, fontWeight: '700' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  option: { minHeight: 44, justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.surface, paddingHorizontal: spacing.md },
  selected: { borderColor: color.green, backgroundColor: color.mint },
  label: { color: color.ink, fontSize: typography.caption },
  note: { color: color.muted, fontSize: typography.caption },
});
