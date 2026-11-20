import { normalizeName } from '@cheapo/domain/names';
import type { PriceObservation } from '@cheapo/domain/price-history';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { SavedPriceRecord } from '../data/local-photo';
import { reviewComplete, reviewUnitPrice } from '../data/photo-review';
import { projectLocalPrice, projectSharedPrice, type PendingHistoryChange, type SavedPriceHistoryRow } from '../data/saved-price-history';
import { PriceDisplay } from './results/price-display';
import { color, radius, spacing, typography, ui } from './results/theme';
import { PendingPriceNotice } from './shared-price-evidence';

export function SavedPriceDetails({ draft }: { draft: SavedPriceRecord }) {
  const { review } = draft;
  const shop = draft.shop?.displayName ?? normalizeName(review?.shop);
  const complete = reviewComplete(review, draft.shop?.displayName);
  const name = normalizeName(review?.productName);
  const metadata = [
    ['Type', normalizeName(review?.productType)], ['Variety', normalizeName(review?.variety)],
    ['Brand', normalizeName(review?.brand)], ['Pack', normalizeName(review?.packSize)],
  ].flatMap(([label, value]) => value ? [`${label}: ${value}`] : []).join(' · ');

  return (
    <View style={styles.details}>
      <Text style={styles.name}>{name ?? 'Photo draft'}</Text>
      <Text style={ui.body}>{shop ?? 'Shop not recorded'}</Text>
      {metadata ? <Text style={ui.small}>{metadata}</Text> : null}
      {complete && review ? <PriceDisplay price={Number(review.price)} currency={review.currency} unit_price={reviewUnitPrice(review)} />
        : name ? <Text style={ui.small}>Photo draft</Text> : null}
    </View>
  );
}

type ThumbnailLoader = (id: string, changes: readonly PendingHistoryChange[], signal: AbortSignal) => Promise<string | undefined>;
const cardViewability = { minimumViewTime: 120, itemVisiblePercentThreshold: 20 };

function SharedPriceThumbnail({ observation, changes, visible, load }: {
  observation: PriceObservation;
  changes: readonly PendingHistoryChange[];
  visible: boolean;
  load: ThumbnailLoader;
}) {
  const [result, setResult] = useState<{ observation: PriceObservation; changes: typeof changes; load: ThumbnailLoader; uri?: string }>();
  const current = result?.observation === observation && result.changes === changes && result.load === load ? result : undefined;

  useEffect(() => {
    if (!visible || current || !observation.photos.some(photo => photo.availability !== 'pending')) return;
    const controller = new AbortController();
    function complete(uri?: string) {
      if (!controller.signal.aborted) setResult({ observation, changes, load, uri });
    }
    void load(observation.id, changes, controller.signal).then(complete, () => complete());
    return () => controller.abort();
  }, [observation, changes, visible, load, current]);

  return current?.uri
    ? <Image accessibilityLabel="Saved price thumbnail" source={{ uri: current.uri }} style={styles.thumbnail}
      onError={() => setResult(previous => previous === current ? { ...current, uri: undefined } : previous)} />
    : <View style={styles.thumbnail} />;
}

type SavedPriceHistoryListProps = {
  rows: SavedPriceHistoryRow[];
  changes: readonly PendingHistoryChange[];
  onOpen(row: SavedPriceHistoryRow): void;
  loadSharedThumbnail?: ThumbnailLoader;
  header?: ReactElement;
  empty?: ReactElement;
  footer?: ReactElement;
};

export function SavedPriceHistoryPane({ detail, ...list }: SavedPriceHistoryListProps & { detail?: ReactElement }) {
  const covered = Boolean(detail);
  return <View style={ui.page}>
    {/* Keep the native scroll view laid out while its detail is open. */}
    <View style={ui.page} pointerEvents={covered ? 'none' : 'auto'} aria-hidden={covered}
      accessibilityElementsHidden={covered} importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}>
      <SavedPriceHistoryList {...list} active={!covered} />
    </View>
    {detail ? <View style={[StyleSheet.absoluteFill, ui.page]}>{detail}</View> : null}
  </View>;
}

export function SavedPriceHistoryList({ rows, changes, onOpen, loadSharedThumbnail, header, empty, footer, active = true }:
  SavedPriceHistoryListProps & { active?: boolean }) {
  const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(new Set());
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: readonly { key: string }[] }) => {
    setVisibleKeys(new Set(viewableItems.map(item => item.key)));
  }, []);

  return <FlatList viewabilityConfig={cardViewability} onViewableItemsChanged={onViewableItemsChanged} extraData={visibleKeys}
    scrollEnabled={active}
    style={ui.page} contentContainerStyle={ui.content} data={rows} keyExtractor={row => row.key}
    ListHeaderComponent={header} ListEmptyComponent={empty} ListFooterComponent={footer}
    renderItem={({ item }) => {
      if (item.source === 'shared') {
        const { display, pending } = projectSharedPrice(item.observation, changes);
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${display.productName ?? 'shared price'}`}
            onPress={() => onOpen(item)} style={[ui.card, styles.card]}>
            {loadSharedThumbnail ? <SharedPriceThumbnail observation={item.observation} changes={changes}
              visible={active && visibleKeys.has(item.key)} load={loadSharedThumbnail} /> : null}
            <View style={styles.details}>
              <Text style={styles.name}>{display.productName ?? 'Shared price'}</Text>
              {display.shopDisplayName ? <Text style={ui.body}>{display.shopDisplayName}</Text> : null}
              {display.recordedInErrorReason ? <Text style={ui.small}>Recorded in error</Text> : null}
              <PendingPriceNotice state={pending} />
              <PriceDisplay price={display.priceAmount === null ? null : Number(display.priceAmount)}
                currency={display.currency} unit_price={display.unitPrice} />
            </View>
          </Pressable>
        );
      }
      const { display, pending, recordedInErrorReason } = projectLocalPrice(item, changes);
      return (
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${normalizeName(display.review?.productName) ?? 'Photo draft'}`}
          onPress={() => onOpen(item)} style={[ui.card, styles.card]}>
          {display.selected ? <Image source={{ uri: display.selected.uri }} style={styles.thumbnail} /> : null}
          <View style={styles.details}>
            <SavedPriceDetails draft={display} />
            <PendingPriceNotice state={pending} />
            {recordedInErrorReason ? <Text style={ui.small}>Recorded in error</Text> : null}
          </View>
        </Pressable>
      );
    }} />;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center' },
  details: { flex: 1, gap: spacing.xs },
  name: { color: color.ink, fontSize: typography.card, fontWeight: '700' },
  thumbnail: { width: 72, height: 72, borderRadius: radius.control, backgroundColor: color.mint },
});
