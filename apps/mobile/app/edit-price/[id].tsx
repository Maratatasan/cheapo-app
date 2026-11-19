import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { Platform, View } from 'react-native';

import { CameraActionButton } from '@/component/camera-actions';
import { PhotoBarcodeScan } from '@/component/photo-barcode-scan';
import { SavedPriceBarcode } from '@/component/saved-price-barcode';
import { PhotoReview } from '@/component/photo-review';
import { DisplayState } from '@/component/results/display-state';
import { ui } from '@/component/results/theme';
import { linkSavedPriceToBarcode, loadSavedPriceRecord, saveLocalPhotoReview, type SavedPriceRecord } from '@/data/local-photo';
import { findLocalProductByBarcode, findLocalProductById } from '@/data/local-products';
import { decodePhotoBarcodes } from '@/data/photo-barcode';
import { reviewComplete, type ManualReview } from '@/data/photo-review';

type EditableProduct = SavedPriceRecord & { review: ManualReview };

export default function EditSavedPrice() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<{ id: string; product: EditableProduct | null }>();
  const product = loaded?.id === id ? loaded?.product : undefined;
  const [review, setReview] = useState<ManualReview>();
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkedBarcode, setLinkedBarcode] = useState<string>();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLinkOpen(false);
    setLinkedBarcode(undefined);
    lifecycle.current = controller;
    if (Platform.OS !== 'web') {
      loadSavedPriceRecord(id).then(draft => {
        if (controller.signal.aborted) return;
        if (draft?.review && reviewComplete(draft.review, draft.shop?.displayName)) {
          setLoaded({ id, product: { ...draft, review: draft.review } });
          setReview(draft.review);
          if (draft.productId) void findLocalProductById(draft.productId).then(linked => {
            if (!controller.signal.aborted) setLinkedBarcode(linked?.barcode);
          }).catch(() => {});
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
          saved={false} busy={busy} onReviewChange={setReview} onCancel={leave} onSave={save} saveError={error}
          savedBarcode={linkedBarcode}
          barcodeReview={!product.productId && product.original && !linkedBarcode ? (
            linkOpen ? <SavedPriceBarcode key={product.id} record={{ ...product, original: product.original, selected: product.selected }}
              lookup={findLocalProductByBarcode} readPhoto={decodePhotoBarcodes} link={linkSavedPriceToBarcode}
              onLinked={code => { setLinkedBarcode(code); setLinkOpen(false); }} onCancel={() => setLinkOpen(false)}
              renderScanner={permission ? callbacks => <PhotoBarcodeScan permission={permission}
                requestPermission={requestPermission} {...callbacks} /> : undefined} />
              : <CameraActionButton label="Link barcode" disabled={busy} onPress={() => setLinkOpen(true)} />
          ) : undefined} />
      ) : (
        <View style={ui.content}>
          {Platform.OS === 'web' || product === null ? (
            <DisplayState kind="empty" title="Saved product unavailable"
              description="Open a saved product from the phone app." actionLabel="Back to saved products" onAction={leave} />
          ) : <DisplayState kind="loading" title="Loading saved product" description="Reading the saved price details." />}
        </View>
      )}
    </>
  );
}
