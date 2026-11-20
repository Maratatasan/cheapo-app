import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { color, spacing, typography, ui } from './results/theme';

export type PendingSyncItem = {
  id: string;
  title: string;
  state: 'waiting' | 'failed' | 'photo-pending' | 'needs-shop' | 'conflict';
};

type Props = {
  snapshot: { state: 'loading' | 'unavailable' } | { state: 'ready'; items: readonly PendingSyncItem[] };
  retrying?: boolean;
  onRetry(): void;
  onReload(): void;
  onChooseShop(id: string): void;
  onReviewConflict(id: string): void;
  onBack(): void;
  bottomInset?: number;
};

const stateText = {
  waiting: 'Saved on this phone · Waiting to sync',
  failed: 'Could not sync',
  'photo-pending': 'Price synced · Photo pending',
  'needs-shop': 'Needs shop',
  conflict: 'Conflicting changes',
} satisfies Record<PendingSyncItem['state'], string>;

function SyncButton({ label, accessibleLabel, onPress, secondary, disabled = false }: {
  label: string;
  accessibleLabel?: string;
  onPress(): void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibleLabel} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress} style={[ui.button, secondary && styles.secondary, disabled && styles.disabled]}>
      <Text style={[ui.buttonText, secondary && styles.secondaryText]}>{label}</Text>
    </Pressable>
  );
}

export function PendingSync({ snapshot, retrying = false, onRetry, onReload, onChooseShop, onReviewConflict, onBack, bottomInset = 0 }: Props) {
  const items = snapshot.state === 'ready' ? snapshot.items : [];
  const canRetry = items.some(({ state }) => state !== 'needs-shop' && state !== 'conflict');

  function renderItem({ item }: { item: PendingSyncItem }) {
    const warning = item.state === 'failed' || item.state === 'needs-shop' || item.state === 'conflict';
    return (
      <View style={[ui.card, styles.item]}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={[ui.body, warning && styles.warning]}>{stateText[item.state]}</Text>
        {item.state === 'needs-shop' ? (
          <SyncButton label="Choose shop" accessibleLabel={`Choose shop for ${item.title}`} secondary onPress={() => onChooseShop(item.id)} />
        ) : null}
        {item.state === 'conflict' ? (
          <SyncButton label="Review conflict" accessibleLabel={`Review conflict for ${item.title}`} secondary onPress={() => onReviewConflict(item.id)} />
        ) : null}
      </View>
    );
  }

  return (
    <View style={ui.page}>
      <FlatList style={ui.page} contentContainerStyle={ui.content} contentInsetAdjustmentBehavior="automatic"
        data={items} renderItem={renderItem} keyExtractor={item => item.id}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={<Text accessibilityRole="header" style={styles.heading}>Pending changes</Text>}
        ListEmptyComponent={snapshot.state === 'unavailable' ? (
          <View style={ui.card}>
            <Text accessibilityRole="alert" style={styles.warning}>Could not read pending changes.</Text>
            <SyncButton label="Try again" secondary onPress={onReload} />
          </View>
        ) : (
          <Text accessibilityLiveRegion="polite" style={ui.body}>
            {snapshot.state === 'loading' ? 'Checking pending changes…' : 'No changes waiting to sync.'}
          </Text>
        )}
      />
      <View style={[styles.footer, { paddingBottom: spacing.md + bottomInset }]}>
        <View style={styles.controls}>
          <SyncButton label={retrying ? 'Syncing…' : 'Retry sync'} disabled={retrying || !canRetry} onPress={onRetry} />
          <SyncButton label="Back to Home" secondary onPress={onBack} />
        </View>
      </View>
    </View>
  );
}

function Gap() { return <View style={styles.gap} />; }

const styles = StyleSheet.create({
  heading: { fontSize: typography.section, fontWeight: '800', color: color.ink, marginBottom: spacing.md },
  item: { gap: spacing.sm },
  title: { fontSize: typography.card, fontWeight: '700', color: color.ink },
  warning: { color: color.warningInk, fontSize: typography.body },
  gap: { height: spacing.md },
  secondary: { backgroundColor: color.mint },
  secondaryText: { color: color.green },
  disabled: { opacity: 0.5 },
  footer: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  controls: { gap: spacing.sm, width: '100%', maxWidth: 696, alignSelf: 'center' },
});
