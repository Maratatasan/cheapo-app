import { reviewedPackParts } from '@cheapo/domain/package-measures';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';

import type { ProductIdentityDraft } from '@/data/ai-observation';
import type { ProductCandidate, ProductCandidateSearch } from '@/data/cheapo-shopping-reads';
import { packSizeMaxLength } from '@/data/photo-review';
import { productMetadataMaxLength } from '@/data/product-metadata';
import { CameraActionButton } from './camera-actions';
import { color, radius, spacing, typography, ui } from './results/theme';

type Matches = { candidates: ProductCandidate[]; truncated: boolean };
type SearchState = { kind: 'entry' | 'checking' } | { kind: 'error'; message: string } | { kind: 'checked'; matches: Matches };

export type ProductCandidateLookupProps = {
  findCandidates: (identity: ProductCandidateSearch, signal: AbortSignal) => Promise<Matches>;
  onCompare: (candidate: ProductCandidate) => void;
  renderIdentitySuggestions?: (onApply: (draft: ProductIdentityDraft) => void, busy: boolean) => ReactNode;
};

const fields = [
  ['name', 'Product name', 200],
  ['brand', 'Brand (optional)', productMetadataMaxLength],
  ['variety', 'Variety (optional)', productMetadataMaxLength],
  ['packSize', 'Pack size (optional)', packSizeMaxLength],
] as const;

export function ProductCandidateLookup({ findCandidates, onCompare, renderIdentitySuggestions }: ProductCandidateLookupProps) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState({ name: '', brand: '', variety: '', packSize: '' });
  const [state, setState] = useState<SearchState>({ kind: 'entry' });
  const active = useRef<AbortController | null>(null);

  useEffect(() => {
    setState({ kind: 'entry' });
    return () => active.current?.abort();
  }, [findCandidates]);

  function changeField(key: keyof typeof values, value: string) {
    active.current?.abort();
    setValues(current => ({ ...current, [key]: value }));
    setState({ kind: 'entry' });
  }

  function applySuggestions(draft: ProductIdentityDraft) {
    active.current?.abort();
    setValues(current => ({
      name: draft.product ?? current.name, brand: draft.brand ?? current.brand,
      variety: draft.variety ?? current.variety, packSize: draft.packSize ?? current.packSize,
    }));
    setState({ kind: 'entry' });
  }

  async function search() {
    const { name, brand, variety, packSize } = values;
    if (!name.trim()) return;
    if ([name, brand, variety].some(value => value.trim() && (/\p{Cc}/u.test(value.trim()) || !/[\p{L}\p{N}]/u.test(value)))) {
      setState({ kind: 'error', message: 'Enter product details using letters or numbers.' });
      return;
    }
    const pack = reviewedPackParts(packSize);
    const quantity = pack && pack.count * Number(pack.quantity);
    if (packSize.trim() && (!quantity || !Number.isFinite(quantity))) {
      setState({ kind: 'error', message: 'Enter a pack quantity and unit, or clear the pack size.' });
      return;
    }
    Keyboard.dismiss();
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ kind: 'checking' });
    try {
      const matches = await findCandidates(values, controller.signal);
      if (!controller.signal.aborted) setState({ kind: 'checked', matches });
    } catch {
      if (!controller.signal.aborted) setState({ kind: 'error', message: 'Could not check the catalog. Try again.' });
    }
  }

  if (!expanded) return <CameraActionButton label="Find by packaging details" onPress={() => setExpanded(true)} />;

  return <View style={ui.card}>
    <Text accessibilityRole="header" style={styles.heading}>Packaging details</Text>
    {renderIdentitySuggestions?.(applySuggestions, state.kind === 'checking')}
    {fields.map(([key, label, maxLength]) => <View key={key} style={styles.field}>
      <Text style={ui.body}>{label}</Text>
      <TextInput accessibilityLabel={label} value={values[key]} maxLength={maxLength} style={styles.input}
        onChangeText={value => changeField(key, value)} />
    </View>)}
    <CameraActionButton primary label={state.kind === 'checking' ? 'Checking catalog…' : 'Check catalog'}
      busy={state.kind === 'checking'} disabled={!values.name.trim()} onPress={() => { void search(); }} />
    {state.kind === 'error' ? <Text accessibilityRole="alert" style={ui.body}>{state.message}</Text> : null}
    {state.kind === 'checked' ? <>
      <Text accessibilityLiveRegion="polite" style={styles.heading}>
        {state.matches.candidates.length ? 'Possible matches' : state.matches.truncated ? 'Search was limited' : 'No matching products found'}
      </Text>
      {state.matches.truncated ? <Text style={ui.body}>Refine the packaging details to check more precisely.</Text> : null}
      {state.matches.candidates.map(candidate => {
        const catalogItem = candidate.kind === 'catalog';
        const details = catalogItem ? candidate.product : candidate.details;
        const pack = !catalogItem && candidate.details.packSize ? candidate.details.packSize
          : details.pack?.label ?? (details.pack && `${details.pack.quantity} ${details.pack.unit}`);
        const subtitle = [details.brand, details.variety, pack].filter(Boolean).join(' · ');
        return <View key={catalogItem ? `product:${candidate.product.id}` : `price:${candidate.observationId}`} style={styles.result}>
          <Text style={styles.heading}>{details.name}</Text>
          {subtitle ? <Text style={ui.body}>{subtitle}</Text> : null}
          {!catalogItem ? <Text style={ui.small}>Saved price without a linked product</Text> : null}
          <CameraActionButton label={`Compare ${details.name}`} onPress={() => onCompare(candidate)} />
        </View>;
      })}
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  heading: { color: color.ink, fontWeight: '700', fontSize: typography.label },
  field: { gap: spacing.xs },
  input: { minHeight: 48, borderColor: color.line, borderWidth: 1, borderRadius: radius.control,
    paddingHorizontal: spacing.md, color: color.ink, fontSize: typography.label },
  result: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderColor: color.line },
});
