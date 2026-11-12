import { useCallback, useRef, useState } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, ScrollView } from 'react-native';

import { DisplayState } from '@/component/results/display-state';
import { ShopComparison } from '@/component/results/shop-comparison';
import { ui } from '@/component/results/theme';
import { loadLocalPhotos, type LocalPhotoDraft } from '@/data/local-photo';
import { comparisonRowFromDraft } from '@/data/saved-comparison';

export default function SavedComparison() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [drafts, setDrafts] = useState<LocalPhotoDraft[]>();
  const [error, setError] = useState(false);
  const focus = useRef<AbortController | null>(null);

  const refresh = useCallback((signal: AbortSignal) => {
    setError(false);
    loadLocalPhotos().then(saved => { if (!signal.aborted) setDrafts(saved); })
      .catch(() => { if (!signal.aborted) setError(true); });
  }, []);

  useFocusEffect(useCallback(() => {
    if (Platform.OS === 'web') return;
    const controller = new AbortController();
    focus.current = controller;
    refresh(controller.signal);
    return () => { controller.abort(); focus.current = null; };
  }, [refresh]));

  const draft = drafts?.find(item => item.id === id);
  const reference = draft && comparisonRowFromDraft(draft);
  const comparisons = (drafts ?? []).flatMap(item => comparisonRowFromDraft(item) ?? []);

  return (
    <>
      <Stack.Screen options={{ title: 'Compare saved prices' }} />
      <ScrollView style={ui.page} contentContainerStyle={ui.content}>
        {Platform.OS === 'web' ? (
          <DisplayState kind="empty" title="Compare saved prices on your phone"
            description="Your saved products and photos are stored on your phone." />
        ) : error ? (
          <DisplayState kind="error" title="Couldn’t load saved prices"
            description="Try reading the saved products again." actionLabel="Retry" onAction={() => { if (focus.current) refresh(focus.current.signal); }} />
        ) : !drafts ? (
          <DisplayState kind="loading" title="Loading saved prices" description="Reading saved products on this phone." />
        ) : !draft || !reference ? (
          <DisplayState kind="empty" title="Saved product unavailable"
            description="Open a completed review from Saved products and photos to compare prices." />
        ) : (
          <ShopComparison key={draft.id} reference={reference} comparisons={comparisons}
            product={{ name: reference.product, photo: { uri: draft.selected.uri } }}
            onEdit={recordId => router.push({ pathname: '/edit-price/[id]', params: { id: recordId } })} />
        )}
      </ScrollView>
    </>
  );
}
