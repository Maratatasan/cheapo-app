import type { PriceHistoryQuery, PriceObservationDetail } from '@cheapo/domain/price-history';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { MarketScanActions } from '@/component/results/market-scan-actions';
import { DisplayState } from '@/component/results/display-state';
import { ShopComparison } from '@/component/results/shop-comparison';
import { marketColor, ui } from '@/component/results/theme';
import { cheapoShoppingReadCache } from '@/data/cheapo-shopping-read-cache';
import { openCheapoSavedPriceReads } from '@/data/cheapo-shopping-read-device';
import { loadSavedPriceRecords } from '@/data/local-photo';
import { comparisonRowFromSavedHistory, keptSharedPrice, projectSharedPrice, savedPriceHistoryRows, type PendingHistoryChange, type SavedPriceHistoryRow } from '@/data/saved-price-history';
import { viewedPricePhotoRoles } from '@/data/selected-price-photo-read';
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

function comparisonQuery(row: ReturnType<typeof comparisonRowFromSavedHistory>): PriceHistoryQuery | undefined {
  if (!row) return;
  const currency = row.currency ?? undefined;
  if (row.productType) return { productType: row.productType, currency };
  if (row.productId) return { productId: row.productId, currency };
}

function findReference(rows: SavedPriceHistoryRow[], reference?: SavedPriceHistoryRow) {
  if (!reference) return undefined;
  return rows.find(row => row.key === reference.key
    || row.source === 'shared' && row.linkedLocal?.key === reference.key) ?? reference;
}

async function readOffers(reader: Reader, state: ComparisonState, initialQuery: PriceHistoryQuery | undefined,
  signal: AbortSignal, latest: () => boolean, cursor?: string): Promise<ComparisonState> {
  if (!initialQuery || !latest()) return state;
  let query = initialQuery;
  let page = await reader.loadPriceHistory({ ...query, ...(cursor ? { cursor } : {}) }, signal);
  reader.assertCurrent();
  if (!latest()) return state;
  if (page.status === 'unavailable') return { ...state, unavailable: true };
  let input = { ...state.input, shared: [...state.input.shared, ...page.value.observations] };
  const reference = findReference(savedPriceHistoryRows(input), state.reference);
  if (reference?.source === 'shared') {
    const sharedQuery = comparisonQuery(comparisonRowFromSavedHistory(reference, state.changes));
    if (JSON.stringify(sharedQuery) !== JSON.stringify(query)) {
      input = { ...input, shared: [reference.observation] };
      const reset = { ...state, input, reference, next: undefined };
      if (!sharedQuery) return reset;
      query = sharedQuery;
      page = await reader.loadPriceHistory(query, signal);
      reader.assertCurrent();
      if (!latest()) return state;
      if (page.status === 'unavailable') return { ...reset, unavailable: true };
      input.shared.push(...page.value.observations);
    }
  }
  return { ...state, input, reference, unavailable: false, lastSyncedAt: page.lastSyncedAt,
    cached: page.status === 'cached' || Boolean(state.cached),
    next: page.value.nextCursor ? { reader, query, cursor: page.value.nextCursor } : undefined };
}

async function readReferencePhoto(reader: Reader, reference: SavedPriceHistoryRow | undefined, changes: readonly PendingHistoryChange[],
  signal: AbortSignal, latest: () => boolean, checkedDetail?: PriceObservationDetail) {
  if (!latest() || reference?.source !== 'shared') return undefined;
  const { id, version } = reference.observation;
  let detail = checkedDetail;
  try {
    if (detail?.id !== id || detail.version < version) {
      const read = await reader.loadPriceObservation(id, signal);
      reader.assertCurrent();
      if (!latest() || read?.status === 'unavailable') return undefined;
      detail = read?.value.observation ?? undefined;
      if (!detail || detail.version < version) return undefined;
    }
    const selection = projectSharedPrice(detail, changes).display;
    const role = selection.selectedPhotoRole;
    if (!role || !viewedPricePhotoRoles(selection).some(photo => photo.role === role && photo.availability !== 'pending')) return undefined;
    const photo = await reader.loadSelectedPhoto(selection, role, signal);
    reader.assertCurrent();
    return latest() && photo.status !== 'unavailable' ? photo.value.uri : undefined;
  } catch (error) {
    if (error instanceof CheapoAccessError) throw error;
    return undefined;
  }
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

  useEffect(() => {
    if (!shopping) return;
    return cheapoShoppingReadCache.subscribeClear(() => {
      request.current++;
      setState(undefined);
      setPaging(false);
      setError(true);
    });
  }, [shopping]);

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
      const localInput: LocalInputs = { legacy, queued: queue.entries, shared: [] };
      const localReference = savedPriceHistoryRows(localInput).find(row => row.key === key);
      const canonicalId = source === 'shared' ? id : localReference?.source === 'queued' ? localReference.receipt?.id : undefined;
      const detail = canonicalId ? await reader.loadPriceObservation(canonicalId, signal) : undefined;
      reader.assertCurrent();
      if (!latest()) return;
      const observed = detail && detail.status !== 'unavailable' ? detail.value.observation : null;
      const kept = canonicalId && (observed || detail?.status !== 'fresh')
        ? keptSharedPrice(canonicalId, changes, observed?.version) : undefined;
      const cloudReference = kept ?? observed;
      const input: LocalInputs = { ...localInput, shared: cloudReference ? [cloudReference] : [] };
      const selected = cloudReference ? savedPriceHistoryRows(input).find(row => row.key === `shared:${cloudReference.id}`) : localReference;
      const query = selected && comparisonQuery(comparisonRowFromSavedHistory(selected, changes));
      const selectedPhotoUri = !cloudReference && localReference?.source !== 'shared' ? localReference?.record.selected?.uri : undefined;
      const initial = { key, runtime: shopping, input, reference: selected, changes, photoUri: selectedPhotoUri, cached: Boolean(kept) };
      setState(initial);
      const offers = await readOffers(reader, initial, query, signal, latest);
      if (!latest()) return;
      const sharedReference = offers.reference?.source === 'shared';
      setState(sharedReference ? { ...offers, photoUri: undefined } : offers);
      const photoUri = await readReferencePhoto(reader, offers.reference, changes, signal, latest, cloudReference ?? undefined);
      if (latest() && photoUri) {
        setState(previous => previous?.input === offers.input ? { ...previous, photoUri } : previous);
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
    if (!current || !next || !signal || paging) return;
    const generation = request.current;
    const latest = () => generation === request.current && !signal.aborted;
    setPaging(true);
    try {
      const result = await readOffers(next.reader, current, next.query, signal, latest, next.cursor);
      if (!latest()) return;
      const reference = result.reference;
      const before = current.reference;
      const changedPhoto = reference?.source === 'shared' && (before?.source !== 'shared'
        || reference.key !== before.key || reference.observation.version !== before.observation.version);
      setState(previous => {
        if (!latest() || !previous || previous.next !== next) return previous;
        return { ...result, photoUri: changedPhoto ? undefined : previous.photoUri };
      });
      if (changedPhoto) {
        const photoUri = await readReferencePhoto(next.reader, reference, result.changes, signal, latest);
        if (latest() && photoUri) {
          setState(previous => previous?.input === result.input ? { ...previous, photoUri } : previous);
        }
      }
    } catch (failure) {
      if (!latest()) return;
      if (failure instanceof CheapoAccessError) void refresh(signal);
      else setState(previous => previous?.next === next ? { ...previous, unavailable: true } : previous);
    } finally {
      if (latest()) setPaging(false);
    }
  }

  const changes = current?.changes ?? [];
  const rows = current ? savedPriceHistoryRows(current.input) : [];
  const referenceRow = findReference(rows, current?.reference);
  const reference = referenceRow && comparisonRowFromSavedHistory(referenceRow, changes);
  const comparisons = rows.flatMap(row => comparisonRowFromSavedHistory(row, changes) ?? []);

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
                exactProductId={!reference.productType ? reference.productId ?? undefined : undefined}
                product={{ name: reference.product, pack: reference.pack, photo: current.photoUri ? { uri: current.photoUri } : undefined }}
                onEdit={recordId => {
                  const row = recordId === referenceRow.key ? referenceRow : rows.find(item => item.key === recordId);
                  if (row && row.source !== 'shared') router.push({ pathname: '/edit-price/[id]', params: { id: row.record.id } });
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
