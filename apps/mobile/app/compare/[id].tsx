import type { PriceHistoryQuery } from '@cheapo/domain/price-history';
import { useCallback, useRef, useState } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { MarketScanActions } from '@/component/results/market-scan-actions';
import { DisplayState } from '@/component/results/display-state';
import { ShopComparison } from '@/component/results/shop-comparison';
import { marketColor, ui } from '@/component/results/theme';
import { openCheapoSavedPriceReads } from '@/data/cheapo-shopping-read-device';
import { loadSavedPriceRecords } from '@/data/local-photo';
import { comparisonRowFromSavedHistory, savedPriceHistoryRows, type PendingHistoryChange, type SavedPriceHistoryRow } from '@/data/saved-price-history';
import { CheapoAccessError } from '@/lib/cheapo-access/client';

type Runtime = ReturnType<typeof useCheapoShopping>;
type LocalInputs = Parameters<typeof savedPriceHistoryRows>[0];
type Reader = Awaited<ReturnType<typeof openCheapoSavedPriceReads>>;
type ComparisonState = {
  runtime: Runtime;
  key: string;
  input: LocalInputs;
  changes: readonly PendingHistoryChange[];
  reference?: SavedPriceHistoryRow;
  photoUri?: string;
  lastSyncedAt?: string;
  cached?: boolean;
  unavailable?: boolean;
  next?: { reader: Reader; query: PriceHistoryQuery; cursor: string };
};

function displayedComparison(row: SavedPriceHistoryRow, changes: readonly PendingHistoryChange[]) {
  const result = comparisonRowFromSavedHistory(row, changes);
  return result ? { ...result, editable: row.source !== 'queued' } : null;
}

export default function SavedComparison() {
  const router = useRouter();
  const shopping = useCheapoShopping();
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const key = `${source === 'shared' || source === 'queued' ? source : 'legacy'}:${id}`;
  const [state, setState] = useState<ComparisonState>();
  const [error, setError] = useState(false);
  const [paging, setPaging] = useState(false);
  const request = useRef(0);
  const focus = useRef<AbortController | null>(null);
  const current = state?.runtime === shopping && state.key === key ? state : undefined;

  const refresh = useCallback(async (signal: AbortSignal) => {
    const generation = ++request.current;
    const latest = () => generation === request.current && !signal.aborted;
    setError(false);
    setPaging(false);
    let local: ComparisonState | undefined;
    try {
      const legacy = await loadSavedPriceRecords();
      if (!latest()) return;
      const inputs = { legacy, queued: [], shared: [] };
      const reference = savedPriceHistoryRows(inputs).find(row => row.key === key);
      local = { key, runtime: shopping, input: inputs, reference, changes: [],
        ...(reference && reference.source !== 'shared' ? { photoUri: reference.record.selected?.uri } : {}) };
      if (!shopping || reference) setState(local);
      if (!shopping) return;

      const reader = await openCheapoSavedPriceReads(shopping.owner);
      const [queue, changes] = await Promise.all([shopping.priceQueue.read(), shopping.loadPriceChanges()]);
      const detail = source === 'shared' ? await reader.loadPriceObservation(id, signal) : undefined;
      reader.assertCurrent();
      if (!latest()) return;
      const cloudReference = detail && detail.status !== 'unavailable' ? detail.value.observation : null;
      const input = { legacy, queued: queue.entries, shared: cloudReference ? [cloudReference] : [] };
      const selected = savedPriceHistoryRows(input).find(row => row.key === key);
      const display = selected && displayedComparison(selected, changes);
      const currentState: ComparisonState = { key, runtime: shopping, input, reference: selected, changes,
        photoUri: selected && selected.source !== 'shared' ? selected.record.selected?.uri : undefined };
      if (!display || !selected) {
        setState(currentState);
        return;
      }
      setState(currentState);
      if (display.productType) {
        const query = { productType: display.productType, currency: display.currency ?? undefined };
        const page = await reader.loadPriceHistory(query, signal);
        reader.assertCurrent();
        if (!latest()) return;
        if (page.status === 'unavailable') {
          setState({ ...currentState, unavailable: true });
        } else {
          setState({ ...currentState, input: { ...input, shared: [...input.shared, ...page.value.observations] },
            lastSyncedAt: page.lastSyncedAt, cached: page.status === 'cached',
            next: page.value.nextCursor ? { reader, query, cursor: page.value.nextCursor } : undefined });
        }
      }
      const role = cloudReference?.selectedPhotoRole;
      if (role && cloudReference?.photos.some(photo => photo.role === role && photo.availability !== 'pending')) {
        const photo = await reader.loadPhoto(id, role, signal).catch(error => {
          if (error instanceof CheapoAccessError) throw error;
          return null;
        });
        reader.assertCurrent();
        if (latest() && photo && photo.status !== 'unavailable') {
          setState(previous => previous?.key === key && previous.runtime === shopping ? { ...previous, photoUri: photo.value.uri } : previous);
        }
      }
    } catch {
      if (!latest()) return;
      if (local?.reference) setState({ ...local, unavailable: Boolean(shopping) });
      else { setState(undefined); setError(true); }
    }
  }, [id, key, shopping, source]);

  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web') return;
    const controller = new AbortController();
    focus.current = controller;
    void refresh(controller.signal);
    return () => { controller.abort(); focus.current = null; };
  }, [refresh]));

  async function loadMore() {
    const next = current?.next;
    const signal = focus.current?.signal;
    if (!next || !signal || paging) return;
    const generation = request.current;
    const latest = () => generation === request.current && !signal.aborted;
    setPaging(true);
    try {
      const page = await next.reader.loadPriceHistory({ ...next.query, cursor: next.cursor }, signal);
      next.reader.assertCurrent();
      if (!latest()) return;
      setState(previous => {
        if (!latest() || !previous || previous.next !== next) return previous;
        if (page.status === 'unavailable') return { ...previous, unavailable: true };
        return { ...previous, input: { ...previous.input, shared: [...previous.input.shared, ...page.value.observations] },
          unavailable: false, cached: page.status === 'cached' || previous.cached, lastSyncedAt: page.lastSyncedAt,
          next: page.value.nextCursor ? { ...next, cursor: page.value.nextCursor } : undefined };
      });
    } catch (failure) {
      if (!latest()) return;
      if (failure instanceof CheapoAccessError) void refresh(signal);
      else setState(previous => previous?.next === next ? { ...previous, unavailable: true } : previous);
    } finally {
      if (latest()) setPaging(false);
    }
  }

  const changes = current?.changes ?? [];
  const rows = current ? savedPriceHistoryRows(current.input).filter(row => row.source !== 'shared' || row.linkedLocal?.key !== current.reference?.key) : [];
  const referenceRow = current?.reference?.source === 'shared' ? rows.find(row => row.key === current.reference?.key) : current?.reference;
  const reference = referenceRow && displayedComparison(referenceRow, changes);
  const comparisons = rows.flatMap(row => displayedComparison(row, changes) ?? []);

  return (
    <>
      <Stack.Screen options={{ title: 'Compare prices', headerStyle: { backgroundColor: marketColor.background }, headerTintColor: marketColor.ink }} />
      <View style={{ flex: 1, backgroundColor: marketColor.background }}>
        <ScrollView contentContainerStyle={ui.content}>
          {Platform.OS === 'web' ? (
            <DisplayState kind="empty" title="Compare saved prices on your phone"
              description="Your saved products and photos are stored on your phone." />
          ) : error ? (
            <DisplayState kind="error" title="Couldn’t load saved prices"
              description="Try reading the saved products again." actionLabel="Retry" onAction={() => { if (focus.current) void refresh(focus.current.signal); }} />
          ) : !current ? (
            <DisplayState kind="loading" title="Loading saved prices" description={shopping ? 'Reading saved products.' : 'Reading saved products on this phone.'} />
          ) : !reference || !referenceRow ? (
            <DisplayState kind="empty" title="Saved product unavailable"
              description="Open a completed review from Saved products and photos to compare prices." />
          ) : (
            <>
              <ShopComparison key={reference.id} reference={reference} comparisons={comparisons}
                product={{ name: reference.product, pack: reference.pack, photo: current.photoUri ? { uri: current.photoUri } : undefined }}
                onEdit={recordId => {
                  const row = recordId === referenceRow.key ? referenceRow : rows.find(item => item.key === recordId);
                  if (row?.source === 'legacy') router.push({ pathname: '/edit-price/[id]', params: { id: row.record.id } });
                  if (row?.source === 'shared') router.push({ pathname: '/edit-price/[id]', params: { id: row.observation.id, source: 'shared' } });
                }} />
              {current.cached ? <Text style={ui.small}>Showing saved shared prices</Text> : null}
              {current.lastSyncedAt ? <Text style={ui.small}>Last synced {new Date(current.lastSyncedAt).toLocaleString()}</Text> : null}
              {current.unavailable ? <Text style={ui.small}>Shared comparisons unavailable</Text> : null}
              {current.next ? <Button title="Load more saved prices" disabled={paging} onPress={() => { void loadMore(); }} /> : null}
            </>
          )}
        </ScrollView>
        {Platform.OS !== 'web' ? <SafeAreaView edges={['bottom']}><MarketScanActions onScanLabel={() => router.push('/scan')}
          onScanBarcode={() => router.push({ pathname: '/scan', params: { mode: 'barcode' } })} /></SafeAreaView> : null}
      </View>
    </>
  );
}
