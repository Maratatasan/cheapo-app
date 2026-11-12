import { useCallback, useRef, useState } from 'react';
import { Stack, useFocusEffect } from 'expo-router';
import { Button, FlatList, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { normalizeName } from '@cheapo/domain/names';

import { PriceDisplay } from '@/component/results/price-display';
import { color, radius, spacing, typography, ui } from '@/component/results/theme';
import { loadLocalPhotos, reviewComplete, type LocalPhotoDraft } from '@/data/local-photo';

function SavedDetails({ draft }: { draft: LocalPhotoDraft }) {
  const { review } = draft;
  const shop = draft.shop?.displayName ?? normalizeName(review?.shop);
  const complete = reviewComplete(review, draft.shop?.displayName);
  const name = normalizeName(review?.productName);

  return (
    <View style={styles.details}>
      <Text style={styles.name}>{name ?? 'Photo draft'}</Text>
      <Text style={ui.body}>{shop ?? 'Shop not recorded'}</Text>
      {complete && review ? (
        <PriceDisplay
          price={Number(review.price)}
          currency={review.currency}
          unit_price={review.unitPrice.trim() ? { amount: Number(review.unitPrice), unit: review.unit.trim() } : null}
        />
      ) : name ? <Text style={ui.small}>Photo draft</Text> : null}
    </View>
  );
}

export default function SavedProducts() {
  const [drafts, setDrafts] = useState<LocalPhotoDraft[]>();
  const [error, setError] = useState(false);
  const focus = useRef<AbortController | null>(null);
  const [opened, setOpened] = useState<LocalPhotoDraft>();
  const [original, setOriginal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const exportingRef = useRef(false);

  const refresh = useCallback((signal: AbortSignal) => {
    setError(false);
    loadLocalPhotos().then((saved) => {
      if (!signal.aborted) setDrafts(saved);
    }).catch(() => { if (!signal.aborted) setError(true); });
  }, []);

  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web') return;
    const controller = new AbortController();
    focus.current = controller;
    refresh(controller.signal);
    return () => { controller.abort(); focus.current = null; };
  }, [refresh]));

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
      await exportShoppingData(signal);
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
      {opened ? (
        <ScrollView style={ui.page} contentContainerStyle={ui.content}>
          <Button title="Back to saved products" onPress={() => setOpened(undefined)} />
          <SavedDetails draft={opened} />
          <Image
            accessibilityLabel="Saved photo"
            resizeMode="contain"
            source={{ uri: (original ? opened.original : opened.selected).uri }}
            style={styles.preview}
          />
          {opened.original.uri !== opened.selected.uri ? (
            <Button title={original ? 'View crop' : 'View original'} onPress={() => setOriginal(!original)} />
          ) : null}
        </ScrollView>
      ) : (
        <FlatList
          style={ui.page}
          contentContainerStyle={ui.content}
          data={drafts ?? []}
          keyExtractor={(draft) => draft.id}
          ListHeaderComponent={error ? (
            <View style={styles.details}>
              <Text accessibilityRole="alert" style={ui.body}>Could not read saved products and photos.</Text>
              <Button title="Try again" onPress={() => { if (focus.current) refresh(focus.current.signal); }} />
            </View>
          ) : Platform.OS === 'android' && drafts ? (
            <View style={styles.details}>
              <Button title={exporting ? 'Preparing ZIP…' : 'Export saved products and photos'} disabled={exporting} onPress={exportSaved} />
              {exportError ? <Text accessibilityRole="alert" style={ui.body}>{exportError}</Text> : null}
            </View>
          ) : undefined}
          ListEmptyComponent={error ? undefined : (
            <Text style={ui.body} accessibilityLiveRegion="polite">
              {Platform.OS === 'web' ? 'Saved products and photos are available in the phone app.'
                : drafts ? 'Saved items and photo drafts will appear here.' : 'Loading saved products and photos…'}
            </Text>
          )}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${normalizeName(item.review?.productName) ?? 'Photo draft'}`}
              onPress={() => { setOriginal(false); setOpened(item); }}
              style={[ui.card, styles.card]}
            >
              <Image source={{ uri: item.selected.uri }} style={styles.thumbnail} />
              <SavedDetails draft={item} />
            </Pressable>
          )}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center' },
  details: { flex: 1, gap: spacing.xs },
  name: { color: color.ink, fontSize: typography.card, fontWeight: '700' },
  thumbnail: { width: 72, height: 72, borderRadius: radius.control, backgroundColor: color.mint },
  preview: { width: '100%', height: 360, backgroundColor: color.mint },
});
