import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, View } from 'react-native';

import { PhotoReview } from '@/component/photo-review';
import { DisplayState } from '@/component/results/display-state';
import { ui } from '@/component/results/theme';
import { loadLocalPhoto, saveLocalPhotoReview, type LocalPhotoDraft } from '@/data/local-photo';
import { reviewComplete, type ManualReview } from '@/data/photo-review';

type EditableProduct = LocalPhotoDraft & { review: ManualReview };

export default function EditSavedPrice() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<{ id: string; product: EditableProduct | null }>();
  const product = loaded?.id === id ? loaded?.product : undefined;
  const [review, setReview] = useState<ManualReview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    if (Platform.OS !== 'web') {
      loadLocalPhoto(id).then(draft => {
        if (controller.signal.aborted) return;
        if (draft?.review && reviewComplete(draft.review, draft.shop?.displayName)) {
          setLoaded({ id, product: { ...draft, review: draft.review } });
          setReview(draft.review);
        } else setLoaded({ id, product: null });
      }).catch(() => { if (!controller.signal.aborted) setLoaded({ id, product: null }); });
    }
    return () => { controller.abort(); lifecycle.current = null; };
  }, [id]);

  function leave() {
    if (router.canGoBack()) router.back();
    else router.replace('/saved-products');
  }

  async function save() {
    const signal = lifecycle.current?.signal;
    if (!signal || saving.current || !product || !review || product.id !== id || !reviewComplete(review, product.shop?.displayName)) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await saveLocalPhotoReview(id, review);
      if (!signal.aborted) leave();
    } catch {
      if (!signal.aborted) setError('Could not save changes. Your edits are still here. Try again.');
    } finally {
      saving.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit saved product' }} />
      {product && product.id === id && review ? (
        <PhotoReview photo={product.selected} review={review} selectedShopName={product.shop?.displayName ?? product.review.shop}
          saved={false} busy={busy} onReviewChange={setReview} onCancel={leave} onSave={save} saveError={error} />
      ) : (
        <View style={ui.content}>
          {Platform.OS === 'web' || product === null ? (
            <DisplayState kind="empty" title="Saved product unavailable"
              description="Open a saved product from the phone app." actionLabel="Back to saved products" onAction={leave} />
          ) : <DisplayState kind="loading" title="Loading saved product" description="Reading the saved photo and details." />}
        </View>
      )}
    </>
  );
}
