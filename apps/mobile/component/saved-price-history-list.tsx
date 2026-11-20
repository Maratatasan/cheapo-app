import { normalizeName } from '@cheapo/domain/names';
import type { ReactElement } from 'react';
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

export function SavedPriceHistoryList({ rows, changes, onOpen, header, empty, footer }: {
  rows: SavedPriceHistoryRow[];
  changes: readonly PendingHistoryChange[];
  onOpen(row: SavedPriceHistoryRow): void;
  header?: ReactElement;
  empty?: ReactElement;
  footer?: ReactElement;
}) {
  return <FlatList style={ui.page} contentContainerStyle={ui.content} data={rows} keyExtractor={row => row.key}
    ListHeaderComponent={header} ListEmptyComponent={empty} ListFooterComponent={footer}
    renderItem={({ item }) => {
      if (item.source === 'shared') {
        const { display, pending } = projectSharedPrice(item.observation, changes);
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={`Open ${display.productName ?? 'shared price'}`}
            onPress={() => onOpen(item)} style={ui.card}>
            <Text style={styles.name}>{display.productName ?? 'Shared price'}</Text>
            {display.shopDisplayName ? <Text style={ui.body}>{display.shopDisplayName}</Text> : null}
            {display.recordedInErrorReason ? <Text style={ui.small}>Recorded in error</Text> : null}
            <PendingPriceNotice state={pending} />
            <PriceDisplay price={display.priceAmount === null ? null : Number(display.priceAmount)}
              currency={display.currency} unit_price={display.unitPrice} />
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
