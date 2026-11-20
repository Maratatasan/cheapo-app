import { useRef, useState } from 'react';
import { Button, Platform, Pressable, StyleSheet, Text, View, type PressableProps } from 'react-native';
import type { AiPriceDraft, PriceReadings, ProductIdentityDraft, ProductIdentityField } from '@/data/ai-observation';
import { priceLabel, unitPriceLabel } from '@/data/observation';
import { marketColor as color } from './results/theme';

export function PhotoAnalysisControls({ label, status, disabled, onPress, packaging = false }: {
  label: string;
  status?: string;
  disabled?: boolean;
  onPress: () => void;
  packaging?: boolean;
}) {
  return <View style={styles.controls}>
    <Text style={styles.note}>{packaging
      ? 'Analysis sends the selected packaging photo and any text read from it to OpenAI using your ChatGPT plan.'
      : 'Analysis sends the selected photo, any text read from it, and the shop’s country when available to OpenAI using your ChatGPT plan.'}</Text>
    <Button title={label} disabled={disabled} onPress={onPress} />
    <Text aria-live="polite" style={styles.note}>{status}</Text>
  </View>;
}

function SuggestedField<Value>({ label, primary, alternatives = [], chosen, disabled, onChoose, format = String }: {
  label: string;
  primary: Value | null | undefined;
  alternatives?: Value[];
  chosen?: Value;
  disabled: boolean;
  onChoose: (value: Value) => void;
  format?: (value: Value) => string;
}) {
  if (primary == null || primary === '') return <Text style={styles.note}>{label} unconfirmed</Text>;
  const options = [primary, ...alternatives];
  return <View style={styles.readings}>
    <Text style={styles.label}>{label}{options.length > 1 ? ' · Uncertain' : ''}</Text>
    <View accessibilityRole="radiogroup" accessibilityLabel={`${label} suggestion choices`} style={styles.options}>
      {options.map((value, index) => {
        const checked = (chosen ?? primary) === value;
        const onKeyDown: PressableProps['onKeyDown'] = event => {
          if (disabled) return;
          const { key } = event.nativeEvent;
          const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[key];
          if (key !== ' ' && step === undefined) return;
          event.preventDefault();
          const next = (index + (step ?? 0) + options.length) % options.length;
          onChoose(options[next]);
          const node = event.currentTarget as unknown as HTMLElement;
          node.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
        };
        return <Pressable key={index}
          accessibilityRole="radio" accessibilityLabel={`${label}: ${format(value)}`}
          aria-checked={checked} disabled={disabled}
          tabIndex={Platform.OS === 'web' && !checked ? -1 : undefined}
          onKeyDown={Platform.OS === 'web' ? onKeyDown : undefined}
          onPress={() => onChoose(value)}
          style={[styles.pill, checked && styles.selectedPill]}>
          <Text style={[styles.pillText, checked && styles.selectedText]}>{format(value)}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

const packagingFields = [
  ['product', 'Product name'], ['brand', 'Brand'], ['variety', 'Variety'], ['packSize', 'Pack size'],
] as const;

export function ProductIdentitySuggestion({ draft, disabled, onApply }: {
  draft: ProductIdentityDraft;
  disabled: boolean;
  onApply: (draft: ProductIdentityDraft) => void;
}) {
  const [chosen, setChosen] = useState<Partial<Record<ProductIdentityField, string>>>({});
  const hasDetails = packagingFields.some(([field]) => draft[field]);
  return <View style={styles.suggestion}>
    <Text accessibilityRole="header" style={styles.title}>Suggested packaging details</Text>
    <View style={styles.details}>
      {packagingFields.map(([field, label]) => (field === 'product' || draft[field]) && <SuggestedField key={field}
        label={label} primary={draft[field]} alternatives={draft.alternatives?.[field]} chosen={chosen[field]}
        disabled={disabled} onChoose={value => setChosen(current => ({ ...current, [field]: value }))} />)}
      {draft.uncertainty ? <Text style={styles.note}>{draft.uncertainty}</Text> : null}
    </View>
    {hasDetails ? <Button title="Use suggested details" disabled={disabled} onPress={() => onApply({ ...draft, ...chosen })} /> : null}
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
    return <SuggestedField<NonNullable<PriceReadings[Field]>> label={label} primary={values[field] ?? undefined}
      alternatives={draft.alternatives?.[field]} chosen={chosen[field] ?? undefined} disabled={disabled}
      onChoose={value => select(field, value)} format={format} />;
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
      {currency
        ? readings('currency', 'Currency')
        : <Text style={styles.note}>Currency unconfirmed. Check the label and enter prices in the form.</Text>}
      {readings('unit_price', 'Printed unit price', unit_price => unitPriceLabel({ unit_price, currency }))}
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
