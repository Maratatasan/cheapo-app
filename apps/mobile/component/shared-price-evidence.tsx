import { normalizeName } from '@cheapo/domain/names';
import type { PriceObservationDetail } from '@cheapo/domain/price-history';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PriceEvidenceRole } from '../data/cheapo-price-photo-read';
import type { PendingHistoryChange } from '../data/saved-price-history';
import { PriceDisplay } from './results/price-display';
import { color, radius, spacing, typography, ui } from './results/theme';

export type EvidenceView = { role: PriceEvidenceRole } & (
  { status: 'loading' | 'unavailable' } | { status: 'fresh' | 'cached'; uri: string }
);

type Props = {
  observation: PriceObservationDetail;
  lastSyncedAt: string;
  cached: boolean;
  activeRole: PriceEvidenceRole | null;
  photo?: EvidenceView;
  pendingChange?: PendingHistoryChange['state'];
  onPhotoRole(role: PriceEvidenceRole): void;
  onRetryPhoto(): void;
  onBack(): void;
  onCompare?(): void;
  onOpenLocal?(): void;
};

function formatDate(value: string, withTime = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toLocaleString(undefined, { dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}) });
}

const pendingLabel = { waiting: 'Saved on this phone · Waiting to sync', failed: 'Could not sync',
  conflict: 'Conflicting changes', recovery: 'Needs attention' } as const;
export function PendingPriceNotice({ state }: { state?: PendingHistoryChange['state'] }) {
  return state ? <Text style={ui.small}>{pendingLabel[state]}</Text> : null;
}

export function SharedPriceEvidence({
  observation, lastSyncedAt, cached, activeRole, photo, pendingChange, onPhotoRole, onRetryPhoto, onBack, onCompare, onOpenLocal,
}: Props) {
  const [failedUri, setFailedUri] = useState<string>();
  const photoRole = observation.photos.find(asset => asset.role === activeRole);
  const selected = photo?.role === activeRole ? photo : undefined;
  const loaded = (selected?.status === 'fresh' || selected?.status === 'cached') && selected.uri !== failedUri;
  const pending = photoRole?.availability === 'pending';
  const loading = selected?.status === 'loading' || (!pending && photoRole && !selected);
  const lastSyncedLabel = formatDate(lastSyncedAt, true);
  const recordedDate = formatDate(observation.capturedAt);
  const name = normalizeName(observation.productName) ?? 'Saved price';
  const details = [observation.review?.brand, observation.review?.variety, observation.review?.packSize]
    .map(normalizeName).filter(Boolean).join(' · ');

  return (
    <View style={ui.page}>
      <ScrollView contentContainerStyle={ui.content}>
        <View style={styles.summary}>
          <Text accessibilityRole="header" style={ui.title}>{name}</Text>
          {observation.shopDisplayName ? <Text style={ui.body}>{observation.shopDisplayName}</Text> : null}
          {details ? <Text style={ui.body}>{details}</Text> : null}
          <PendingPriceNotice state={pendingChange} />
          <View style={styles.priceBar}>
            {recordedDate ? <Text style={ui.small}>Recorded {recordedDate}</Text> : null}
            <PriceDisplay price={observation.priceAmount === null ? null : Number(observation.priceAmount)}
              currency={observation.currency} unit_price={observation.unitPrice} />
          </View>
        </View>

        {observation.recordedInErrorReason ? (
          <View style={[ui.card, styles.warning]}>
            <Text style={styles.section}>Recorded in error</Text>
            <Text style={ui.body}>{observation.recordedInErrorReason}</Text>
          </View>
        ) : null}

        {photoRole ? (
          <View style={ui.card}>
            <View style={[ui.between, styles.photoHeader]}>
              <Text accessibilityRole="header" style={styles.section}>Price photo</Text>
              {observation.photos.length > 1 ? (
                <View style={styles.roles}>
                  {observation.photos.map(asset => (
                    <Pressable key={asset.role} accessibilityRole="button" accessibilityState={{ selected: activeRole === asset.role }}
                      style={[styles.role, activeRole === asset.role && styles.activeRole]} onPress={() => onPhotoRole(asset.role)}>
                      <Text style={styles.roleLabel}>{asset.role === 'original' ? 'Original' : 'Crop'}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            {loaded ? (
              <Image accessibilityLabel={activeRole === 'original' ? 'Original price photo' : 'Cropped price photo'}
                source={{ uri: selected.uri }} resizeMode="contain" style={styles.photo} onError={() => setFailedUri(selected.uri)} />
            ) : (
              <View accessibilityLiveRegion="polite" style={styles.placeholder}>
                <Text style={ui.body}>{pending ? 'Photo upload pending' : loading ? 'Loading photo…' : 'Photo unavailable'}</Text>
                {pending || !loading ? (
                  <Pressable accessibilityRole="button" style={styles.role} onPress={() => { setFailedUri(undefined); onRetryPhoto(); }}>
                    <Text style={styles.roleLabel}>{pending ? 'Check for photo' : 'Try again'}</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
            {loaded && selected.status === 'cached' ? <Text style={ui.small}>Downloaded photo</Text> : null}
          </View>
        ) : null}

        <View style={styles.summary}>
          {cached ? <Text style={ui.body}>Showing saved details</Text> : null}
          {lastSyncedLabel ? <Text style={ui.small}>Last synced {lastSyncedLabel}</Text> : null}
          {onCompare && !observation.recordedInErrorReason ? (
            <Pressable accessibilityRole="button" style={[styles.role, styles.compare]} onPress={onCompare}>
              <Text style={styles.roleLabel}>Compare saved prices</Text>
            </Pressable>
          ) : null}
          {onOpenLocal ? (
            <Pressable accessibilityRole="button" style={[styles.role, styles.compare]} onPress={onOpenLocal}>
              <Text style={styles.roleLabel}>Open this phone’s copy</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
      <SafeAreaView edges={['bottom']} style={styles.footer}>
        <Pressable accessibilityRole="button" style={[ui.button, styles.back]} onPress={onBack}>
          <Text style={ui.buttonText}>Back to saved products</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: { gap: spacing.xs },
  priceBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: spacing.sm },
  section: { color: color.ink, fontWeight: '700', fontSize: typography.label },
  warning: { backgroundColor: color.amber },
  photoHeader: { flexWrap: 'wrap' },
  roles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  role: { paddingHorizontal: spacing.md, minHeight: 46, justifyContent: 'center', borderRadius: radius.control },
  roleLabel: { color: color.green, fontWeight: '700', fontSize: typography.body },
  activeRole: { backgroundColor: color.mint },
  photo: { width: '100%', height: 220, backgroundColor: color.mint, borderRadius: radius.control },
  placeholder: { minHeight: 100, padding: spacing.md, alignItems: 'center', justifyContent: 'center', backgroundColor: color.cream, borderRadius: radius.control },
  compare: { alignSelf: 'flex-start', backgroundColor: color.mint, marginTop: spacing.sm },
  footer: { backgroundColor: color.cream, borderTopWidth: 1, borderColor: color.line, padding: spacing.md },
  back: { width: '100%', maxWidth: 696, alignSelf: 'center' },
});
