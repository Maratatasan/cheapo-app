import { StyleSheet, Text, View } from 'react-native';
import type { ShelfPriceEvidence } from '@/data/shelf-price-evidence';
import { CameraActionButton } from './camera-actions';
import { spacing, ui } from './results/theme';

export function PhotoPriceReviewAction({ status, onReview, onChooseShop }: {
  status?: ShelfPriceEvidence['kind'];
  onReview?: () => void;
  onChooseShop?: () => void;
}) {
  const message = status === 'clear' ? 'Shelf price found. Review it before saving.'
    : status === 'no-price' ? 'No shelf price found in the photo.'
    : status === 'uncertain' ? 'The photo needs a manual price review.' : 'Checking the photo for a shelf price…';
  return <View style={styles.row}>
    <Text style={ui.small} accessibilityLiveRegion="polite">{message}</Text>
    {onReview ? <CameraActionButton label="Review price from photo" onPress={onReview} />
      : onChooseShop ? <CameraActionButton label="Choose a shop to record a price" onPress={onChooseShop} /> : null}
  </View>;
}

const styles = StyleSheet.create({ row: { gap: spacing.sm } });
