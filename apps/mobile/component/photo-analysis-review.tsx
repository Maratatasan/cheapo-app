import { useRef } from 'react';
import { Button, StyleSheet, Text, View } from 'react-native';
import type { AiPriceDraft } from '@/data/ai-observation';
import { priceLabel, unitPriceLabel } from '@/data/observation';
import { marketColor as color } from './results/theme';

export function PhotoAnalysisControls({ label, status, disabled, onPress }: {
  label: string;
  status?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return <View style={styles.controls}>
    <Text style={styles.note}>Analyse photo sends only the selected photo to OpenAI using your ChatGPT plan.</Text>
    <Button title={label} disabled={disabled} onPress={onPress} />
    <Text aria-live="polite" style={styles.note}>{status}</Text>
  </View>;
}

export function PhotoSuggestion({ draft, disabled, onApply, onFirstLayout }: {
  draft: AiPriceDraft;
  disabled: boolean;
  onApply: () => void;
  onFirstLayout?: (y: number) => void;
}) {
  const reportedLayout = useRef(false);
  return <View style={styles.suggestion} onLayout={onFirstLayout ? event => {
    if (reportedLayout.current) return;
    reportedLayout.current = true;
    onFirstLayout(event.nativeEvent.layout.y);
  } : undefined}>
    <Text accessibilityRole="header" style={styles.title}>Suggested details</Text>
    <View style={styles.details}>
      <Text style={styles.summary}>{draft.product || 'Product unconfirmed'} · {priceLabel(draft)}</Text>
      <Text style={styles.note}>{draft.brand || 'Brand unconfirmed'} · {draft.packSize ?? 'Pack size unconfirmed'}</Text>
      {draft.unit_price ? <Text style={styles.note}>{unitPriceLabel(draft)}</Text> : null}
      {draft.productType ? <Text style={styles.note}>Product type: {draft.productType}</Text> : null}
      {draft.variety ? <Text style={styles.note}>Variety: {draft.variety}</Text> : null}
      {draft.uncertainty ? <Text style={styles.note}>{draft.uncertainty}</Text> : null}
    </View>
    <Button title="Use suggested details" disabled={disabled} onPress={onApply} />
  </View>;
}

const styles = StyleSheet.create({
  controls: { gap: 8, marginBottom: 8 },
  suggestion: { backgroundColor: color.mint, borderRadius: 12, paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
  details: { gap: 6 },
  title: { fontWeight: '700', color: color.ink, fontSize: 18 },
  summary: { fontWeight: '700', color: color.ink, fontSize: 14 },
  note: { color: color.muted, fontSize: 13 },
});
