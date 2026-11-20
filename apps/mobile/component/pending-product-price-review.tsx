import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ProductIdentityCheck } from '@/data/add-product-lookup';
import type { ProductCandidate } from '@/data/cheapo-shopping-reads';
import { dateLabel, priceLabel } from '@/data/observation';
import type { ProductPriceChoice, ProductPriceDraft } from '@/data/price-append-queue';
import { CameraActionButton } from './camera-actions';
import { color, spacing, ui } from './results/theme';

export function PendingProductPriceReview({ draft, check, busy, error, onRetry, onCompare, onConfirm, onEdit, onBack }: {
  draft: ProductPriceDraft;
  check?: ProductIdentityCheck;
  busy: boolean;
  error?: string;
  onRetry: () => void;
  onCompare: (candidate: ProductCandidate) => void;
  onConfirm: (choice: ProductPriceChoice) => void;
  onEdit?: () => void;
  onBack: () => void;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const { record, barcode } = draft;
  const { review, shop } = record;
  if (!review || !shop) return null;
  const photo = showOriginal ? record.original : record.selected;
  const needsProductType = Boolean(barcode && !review.productType?.trim());
  return <View style={ui.page}>
    <ScrollView style={ui.page} contentContainerStyle={ui.content}>
      <Text accessibilityRole="header" style={ui.title}>{review.productName}</Text>
      <View style={ui.card}>
        <Text style={ui.body}>{shop.displayName} · {dateLabel(record.capturedAt.slice(0, 10))}</Text>
        <Text style={ui.body}>Reviewed price {priceLabel({ price: Number(review.price), currency: review.currency })}</Text>
        {[review.brand, review.variety, review.packSize].some(Boolean) ?
          <Text style={ui.body}>{[review.brand, review.variety, review.packSize].filter(Boolean).join(' · ')}</Text> : null}
        {barcode ? <Text style={ui.body}>Barcode {barcode}</Text> : null}
      </View>
      {photo ? <Image accessibilityLabel={showOriginal ? 'Original price photo' : 'Reviewed price photo'}
        source={{ uri: photo.uri }} resizeMode="contain" style={styles.photo} /> : null}
      {record.original && record.original.uri !== record.selected.uri ?
        <CameraActionButton label={showOriginal ? 'View crop' : 'View original'} onPress={() => setShowOriginal(value => !value)} /> : null}
      {onEdit ? <CameraActionButton label="Edit draft details" disabled={busy} onPress={onEdit} /> : null}
      {error ? <Text accessibilityRole="alert" style={ui.body}>{error}</Text> : null}
      {!check ? <Text accessibilityLiveRegion="polite" style={ui.body}>Checking the catalog…</Text> : null}
      {check?.kind === 'unavailable' ? <>
        <Text accessibilityRole="alert" style={ui.body}>Catalog unavailable. Your draft is saved on this phone.</Text>
        <CameraActionButton label="Retry product check" onPress={onRetry} />
      </> : null}
      {check?.kind === 'invalid' ? <Text accessibilityRole="alert" style={ui.body}>{check.message}</Text> : null}
      {check?.kind === 'checked' ? <>
        <Text accessibilityRole="header" style={ui.body}>{check.exact ? 'Product already exists'
          : check.candidates.length ? 'Possible matches' : check.truncated ? 'Search was limited' : 'No matching products found'}</Text>
        {check.candidates.map(candidate => {
          const details = candidate.kind === 'catalog' ? candidate.product : candidate.details;
          const id = candidate.kind === 'catalog' ? candidate.product.id : candidate.observationId;
          const pack = details.pack?.label ?? (details.pack && `${details.pack.quantity} ${details.pack.unit}`);
          return <View key={`${candidate.kind}:${id}`} style={ui.card}>
            <Text style={ui.body}>{details.name}</Text>
            {[details.brand, details.variety, pack].some(Boolean) ?
              <Text style={ui.small}>{[details.brand, details.variety, pack].filter(Boolean).join(' · ')}</Text> : null}
            {candidate.kind === 'catalog' ? <CameraActionButton primary label={`Reuse ${details.name}`} busy={busy}
              onPress={() => onConfirm({ kind: 'reuse', productId: id })} /> : null}
            <CameraActionButton label="Compare saved prices" disabled={busy} onPress={() => onCompare(candidate)} />
          </View>;
        })}
        {!check.exact && !check.truncated ? <>
          {needsProductType ? <Text style={ui.body}>Edit the draft to enter the product type for this barcode.</Text> : null}
          <CameraActionButton label="Add product" primary busy={busy} disabled={needsProductType} onPress={() => onConfirm({ kind: 'add' })} />
        </> : null}
      </> : null}
    </ScrollView>
    <SafeAreaView edges={['bottom']} style={styles.actions}>
      <CameraActionButton label="Back to Pending sync" disabled={busy} onPress={onBack} />
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 220, backgroundColor: color.mint, borderRadius: 12 },
  actions: { padding: spacing.md, borderTopWidth: 1, borderColor: color.line },
});
