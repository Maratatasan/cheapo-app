import { useRef, useState } from 'react';
import { Button, Platform, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
import type { AiPriceDraft, PriceReadings } from '@/data/ai-observation';
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
  onApply: (draft: AiPriceDraft) => void;
  onFirstLayout?: (y: number) => void;
}) {
  const reportedLayout = useRef(false);
  const [chosen, setChosen] = useState<Partial<PriceReadings>>({});
  const values: PriceReadings = draft;
  const currency = chosen.currency ?? draft.currency;

  function select<Field extends keyof PriceReadings>(field: Field, value: NonNullable<PriceReadings[Field]>) {
    setChosen(current => ({ ...current, [field]: value }));
  }

  function readings<Field extends keyof PriceReadings>(
    field: Field, label: string, format: (value: NonNullable<PriceReadings[Field]>) => string = String,
  ) {
    const primary = values[field];
    if (primary == null || primary === '') return <Text style={styles.note}>{label} unconfirmed</Text>;
    const options = [primary, ...(draft.alternatives?.[field] ?? [])];
    const selected = chosen[field] ?? primary;
    return <View style={styles.readings}>
      <Text style={styles.label}>{label}{options.length > 1 ? ' · Uncertain' : ''}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={`${label} suggestion choices`} style={styles.options}>
        {options.map((value, index) => {
          const checked = selected === value;
          const onKeyDown: PressableProps['onKeyDown'] = event => {
            if (disabled) return;
            const { key } = event.nativeEvent;
            const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[key];
            if (key !== ' ' && step === undefined) return;
            event.preventDefault();
            const next = (index + (step ?? 0) + options.length) % options.length;
            select(field, options[next]);
            const node = event.currentTarget as unknown as HTMLElement;
            node.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
          };
          return <Pressable key={index}
            accessibilityRole="radio" accessibilityLabel={`${label}: ${format(value)}`}
            aria-checked={checked} disabled={disabled}
            tabIndex={Platform.OS === 'web' && !checked ? -1 : undefined}
            onKeyDown={Platform.OS === 'web' ? onKeyDown : undefined}
            onPress={() => select(field, value)}
            style={[styles.pill, checked && styles.selectedPill]}>
            <Text style={[styles.pillText, checked && styles.selectedText]}>{format(value)}</Text>
          </Pressable>;
        })}
      </View>
    </View>;
  }

  return <View style={styles.suggestion} onLayout={onFirstLayout ? event => {
    if (reportedLayout.current) return;
    reportedLayout.current = true;
    onFirstLayout(event.nativeEvent.layout.y);
  } : undefined}>
    <Text accessibilityRole="header" style={styles.title}>Suggested details</Text>
    <View style={styles.details}>
      {readings('product', 'Product')}
      {readings('price', 'Total price', price => priceLabel({ price, currency }))}
      {readings('packSize', 'Pack size')}
      {readings('brand', 'Brand')}
      {draft.productType ? readings('productType', 'Product type') : null}
      {draft.variety ? readings('variety', 'Variety') : null}
      {draft.currency ? readings('currency', 'Currency') : null}
      {draft.unit_price ? readings('unit_price', 'Unit price', unit_price => unitPriceLabel({ unit_price, currency })) : null}
      {draft.uncertainty ? <Text style={styles.note}>{draft.uncertainty}</Text> : null}
    </View>
    <Button title="Use suggested details" disabled={disabled} onPress={() => onApply({ ...draft, ...chosen })} />
  </View>;
}

const styles = StyleSheet.create({
  controls: { gap: 8, marginBottom: 8 },
  suggestion: { backgroundColor: color.mint, borderRadius: 12, paddingHorizontal: 14, paddingBottom: 14, gap: 12 },
  details: { gap: 12 },
  title: { fontWeight: '700', color: color.ink, fontSize: 18 },
  readings: { gap: 4 },
  label: { color: color.ink, fontWeight: '600', fontSize: 13 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 22, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface },
  selectedPill: { borderColor: color.green, backgroundColor: color.green },
  pillText: { fontSize: 14, color: color.ink },
  selectedText: { fontWeight: '700', color: color.surface },
  note: { color: color.muted, fontSize: 13 },
});
