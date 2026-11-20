import { useCallback, useMemo, useRef, useState } from 'react';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Button, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { EditPriceButton } from '@/component/results/edit-price-button';
import { color, spacing, ui } from '@/component/results/theme';
import { SavedPriceDetails, SavedPriceHistoryList } from '@/component/saved-price-history-list';
import { PendingPriceNotice, SharedPriceEvidence } from '@/component/shared-price-evidence';
import { loadSavedPriceRecords, reviewComplete, type SavedPriceRecord } from '@/data/local-photo';
import { loadSavedShops } from '@/data/local-shops';
import { projectLocalPrice, projectSharedPrice, savedPriceHistoryRows, type PendingHistoryChange } from '@/data/saved-price-history';
import { useSavedPriceReads, type SavedPriceQueueRead } from '@/data/use-saved-price-reads';

export default function SavedProducts() {
  const shopping = useCheapoShopping();
  return <SavedProductsScreen priceQueue={shopping?.priceQueue} loadPriceChanges={shopping?.loadPriceChanges} />;
}

export function SavedProductsScreen({ priceQueue = null, loadPriceChanges }: {
  priceQueue?: SavedPriceQueueRead | null;
  loadPriceChanges?: () => Promise<readonly PendingHistoryChange[]>;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<SavedPriceRecord[]>();
  const [error, setError] = useState(false);
  const focus = useRef<AbortController | null>(null);
  const [openedId, setOpenedId] = useState<string>();
  const { history, detail, refresh: refreshShared, open: openShared, close: closeShared, abort: abortShared } = useSavedPriceReads(priceQueue, loadPriceChanges);
  const changes = history?.changes ?? [];
  const rows = useMemo(() => savedPriceHistoryRows({
    legacy: drafts ?? [], queued: history?.entries ?? [], shared: history?.observations ?? [],
  }), [drafts, history]);
  const linkedLocal = rows.find(row => row.source === 'shared' && row.observation.id === detail?.id);
  const openedRow = rows.flatMap(row => row.source === 'shared' ? (row.linkedLocal ? [row.linkedLocal] : []) : [row])
    .find(row => row.key === openedId);
  const openedView = openedRow && projectLocalPrice(openedRow, changes);
  const opened = openedView?.display;
  const sharedView = detail && 'observation' in detail ? projectSharedPrice(detail.observation, changes) : undefined;
  const [original, setOriginal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const exportingRef = useRef(false);

  const refresh = useCallback((signal: AbortSignal) => {
    setError(false);
    loadSavedPriceRecords().then((saved) => {
      if (!signal.aborted) setDrafts(saved);
    }).catch(() => { if (!signal.aborted) setError(true); });
  }, []);

  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web') return;
    const controller = new AbortController();
    focus.current = controller;
    refresh(controller.signal);
    if (priceQueue) void refreshShared(controller.signal);
    return () => { controller.abort(); abortShared(); focus.current = null; };
  }, [priceQueue, refresh, refreshShared, abortShared]));

  async function exportSaved() {
    const signal = focus.current?.signal;
    if (!signal || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError(undefined);
    try {
      const { exportShoppingData } = await import('@/lib/shopping-export').catch(() => {
        throw Error('Sharing is unavailable in this build.');
      });
      await exportShoppingData(signal, { loadSavedShops });
    } catch (error) {
      if (!signal.aborted) setExportError(error instanceof Error ? error.message : 'Could not prepare the export.');
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Saved products and photos' }} />
      {detail && 'observation' in detail && sharedView ? (
        <SharedPriceEvidence observation={sharedView.display} lastSyncedAt={detail.lastSyncedAt}
          cached={detail.status === 'cached'} activeRole={detail.role} photo={detail.photo} pendingChange={sharedView.pending}
          onPhotoRole={role => { void openShared(detail.id, role); }}
          onRetryPhoto={() => { void openShared(detail.id, detail.role ?? undefined); }} onBack={closeShared}
          onOpenLocal={linkedLocal?.source === 'shared' && linkedLocal.linkedLocal ? () => {
            closeShared();
            setOriginal(false);
            setOpenedId(linkedLocal.linkedLocal?.key);
          } : undefined} />
      ) : detail ? (
        <View style={ui.page}>
          <View style={[ui.content, styles.fill]}>
            <Text accessibilityLiveRegion="polite" style={ui.body}>
              {detail.status === 'loading' ? 'Loading saved price…' : 'Shared details unavailable'}
            </Text>
            {detail.status === 'unavailable' ? (
              <Button title="Try again" onPress={() => { void openShared(detail.id); }} />
            ) : null}
          </View>
          <SafeAreaView edges={['bottom']} style={styles.footer}>
            <Pressable accessibilityRole="button" style={ui.button} onPress={closeShared}>
              <Text style={ui.buttonText}>Back to saved products</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      ) : opened ? (
        <ScrollView style={ui.page} contentContainerStyle={ui.content}>
          <Button title="Back to saved products" onPress={() => setOpenedId(undefined)} />
          <SavedPriceDetails draft={opened} />
          <PendingPriceNotice state={openedView.pending} />
          {openedView.recordedInErrorReason ? <Text style={ui.body}>Recorded in error · {openedView.recordedInErrorReason}</Text> : null}
          {reviewComplete(opened.review, opened.shop?.displayName) ? (
            <View style={styles.actions}>
              {!openedView.recordedInErrorReason ? (
                <Button title="Compare saved prices" onPress={() => router.push({ pathname: '/compare/[id]', params: { id: opened.id } })} />
              ) : null}
              <EditPriceButton label={`Edit ${opened.review?.productName.trim()}`} onPress={() => router.push({ pathname: '/edit-price/[id]', params: { id: opened.id } })} />
            </View>
          ) : null}
          {opened.original && <Image
            accessibilityLabel="Saved photo"
            resizeMode="contain"
            source={{ uri: (original ? opened.original : opened.selected).uri }}
            style={styles.preview}
          />}
          {opened.original && opened.original.uri !== opened.selected.uri ? (
            <Button title={original ? 'View crop' : 'View original'} onPress={() => setOriginal(!original)} />
          ) : null}
        </ScrollView>
      ) : (
        <SavedPriceHistoryList rows={rows} changes={changes} onOpen={item => {
          if (item.source === 'shared') {
            setOpenedId(undefined);
            void openShared(item.observation.id);
          } else {
            setOriginal(false);
            setOpenedId(item.key);
          }
        }} header={error || history || (Platform.OS === 'android' && drafts) ? (
            <View style={styles.details}>
              {error ? <>
                <Text accessibilityRole="alert" style={ui.body}>Could not read saved products and photos.</Text>
                <Button title="Try again" onPress={() => { if (focus.current) refresh(focus.current.signal); }} />
              </> : Platform.OS === 'android' && drafts ? <>
                <Button title={exporting ? 'Preparing ZIP…' : 'Export saved products and photos'} disabled={exporting} onPress={exportSaved} />
                {exportError ? <Text accessibilityRole="alert" style={ui.body}>{exportError}</Text> : null}
              </> : null}
              {history?.lastSyncedAt ? <Text style={ui.small}>Last synced {new Date(history.lastSyncedAt).toLocaleString()}</Text> : null}
              {history?.status === 'cached' ? <Text style={ui.small}>Showing saved shared prices</Text> : null}
              {history?.status === 'loading' ? <Text accessibilityLiveRegion="polite" style={ui.small}>Loading shared prices…</Text> : null}
              {history?.status === 'unavailable' ? (
                <View>
                  <Text style={ui.small}>Shared prices unavailable</Text>
                  <Button title="Try shared prices again" onPress={() => { if (focus.current) void refreshShared(focus.current.signal); }} />
                </View>
              ) : null}
            </View>
          ) : undefined}
          empty={error || history?.status === 'loading' ? undefined : (
            <Text style={ui.body} accessibilityLiveRegion="polite">
              {Platform.OS === 'web' ? 'Saved products and photos are available in the phone app.'
                : drafts ? 'Saved items and photo drafts will appear here.' : 'Loading saved products and photos…'}
            </Text>
          )}
          footer={history?.nextCursor ? (
            <Button title="Load more saved prices" disabled={history.status === 'loading'} onPress={() => {
              if (focus.current && history.nextCursor) void refreshShared(focus.current.signal, history.nextCursor);
            }} />
          ) : undefined}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  footer: { padding: spacing.md, borderTopWidth: 1, borderColor: color.line },
  details: { flex: 1, gap: spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  preview: { width: '100%', height: 360, backgroundColor: color.mint },
});
