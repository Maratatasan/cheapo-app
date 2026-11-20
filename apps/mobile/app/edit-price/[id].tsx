import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { Platform, View } from 'react-native';

import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { CameraActionButton } from '@/component/camera-actions';
import { PhotoBarcodeScan } from '@/component/photo-barcode-scan';
import { SavedPriceBarcode } from '@/component/saved-price-barcode';
import { PhotoReview } from '@/component/photo-review';
import { DisplayState } from '@/component/results/display-state';
import { ui } from '@/component/results/theme';
import { linkSavedPriceToBarcode, loadSavedPriceRecord, saveLocalPhotoReview } from '@/data/local-photo';
import { openCheapoSavedPriceReads } from '@/data/cheapo-shopping-read-device';
import {
  correctionFromReview, readEnrolledPriceEdit, recordFromObservation, saveEnrolledPriceEdit, type PriceEditRecord, type PriceEditTarget,
} from '@/data/edit-enrolled-price';
import { findLocalProductByBarcode, findLocalProductById } from '@/data/local-products';
import { decodePhotoBarcodes } from '@/data/photo-barcode';
import { reviewComplete, type ManualReview } from '@/data/photo-review';

type EditableProduct = PriceEditRecord & { review: ManualReview };
type EditorData = { product: EditableProduct | null; target?: PriceEditTarget; errorReason?: string };

export default function EditSavedPrice() {
  const router = useRouter();
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const shopping = useCheapoShopping();
  const [loaded, setLoaded] = useState<{ id: string; source?: string; shopping: typeof shopping; data: EditorData }>();
  const current = loaded?.id === id && loaded.source === source && loaded.shopping === shopping ? loaded.data : undefined;
  const product = current?.product;
  const [review, setReview] = useState<ManualReview>();
  const [busy, setBusy] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkedBarcode, setLinkedBarcode] = useState<{ code: string; saved?: boolean }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);
  usePreventRemove(linkSaving);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    const { signal } = controller;
    const show = (data: EditorData) => {
      if (signal.aborted) return;
      setLinkOpen(false);
      setLinkSaving(false);
      setLinkedBarcode(undefined);
      setError(undefined);
      setLoaded({ id, source, shopping, data });
      setReview(data.product?.review);
    };

    async function load() {
      if (source === 'shared') {
        if (!shopping) return show({ product: null });
        const reads = await openCheapoSavedPriceReads(shopping.owner);
        const result = await reads.loadPriceObservation(id, signal);
        const observation = result.status !== 'unavailable' && result.value.observation;
        if (!observation || signal.aborted) return show({ product: null });
        const { record, target, errorReason } = await readEnrolledPriceEdit(shopping, recordFromObservation(observation), observation);
        if (!record.review) return show({ product: null });
        reads.assertCurrent();
        show({ product: { ...record, review: record.review }, target, errorReason });
        if (observation.selectedPhotoRole) {
          const photo = await reads.loadPhoto(id, observation.selectedPhotoRole, signal).catch(() => undefined);
          reads.assertCurrent();
          if (!signal.aborted && photo && photo.status !== 'unavailable') {
            const { uri, width, height } = photo.value;
            setLoaded(state => state?.data.product ? { ...state, data: { ...state.data, product: {
              ...state.data.product, selected: { uri, width, height, mimeType: 'image/jpeg' },
            } } } : state);
          }
        }
        return;
      }

      await shopping?.assertOwner();
      const draft = await (shopping?.priceRecords.load(id) ?? loadSavedPriceRecord(id));
      if (!draft?.review || !reviewComplete(draft.review, draft.shop?.displayName)) return show({ product: null });
      const edit = shopping ? await readEnrolledPriceEdit(shopping, draft) : { record: draft };
      const { record } = edit;
      if (!record.review) return show({ product: null });
      show({ ...edit, product: { ...record, review: record.review } });
      if (record.productId && !shopping) {
        const linked = await findLocalProductById(record.productId).catch(() => undefined);
        if (!signal.aborted && linked?.barcode) setLinkedBarcode({ code: linked.barcode });
      }
    }

    if (Platform.OS !== 'web') void load().catch(() => show({ product: null }));
    return () => { controller.abort(); lifecycle.current = null; };
  }, [id, shopping, source]);

  function leave() {
    if (linkSaving) return;
    if (router.canGoBack()) router.back();
    else router.replace('/saved-products');
  }

  async function save() {
    const signal = lifecycle.current?.signal;
    if (!signal || saving.current || linkOpen || !product || !review || product.id !== id || !reviewComplete(review, product.shop?.displayName)) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (shopping && current?.target) await saveEnrolledPriceEdit(shopping, current.target, review.productName, correctionFromReview(review));
      else if (source === 'shared') throw Error('The shared price needs to be checked again.');
      else {
        await shopping?.assertOwner();
        await saveLocalPhotoReview(id, review);
        await shopping?.assertOwner();
      }
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
          saved={false} busy={busy || linkSaving} onReviewChange={setReview} onCancel={linkOpen ? () => setLinkOpen(false) : leave} onSave={save} saveError={error}
          saveBlocked={linkOpen ? 'Save or cancel the barcode link first.' : undefined}
          savedBarcode={linkedBarcode?.code} barcodeLinkSaved={linkedBarcode?.saved}
          barcodeReview={!shopping && !product.productId && product.original && !linkedBarcode ? (
            linkOpen ? <SavedPriceBarcode key={product.id} record={{ ...product, original: product.original, selected: product.selected ?? product.original }}
              lookup={findLocalProductByBarcode} readPhoto={decodePhotoBarcodes} link={linkSavedPriceToBarcode}
              disabled={busy} onSavingChange={setLinkSaving}
              onLinked={code => { setLinkedBarcode({ code, saved: true }); setLinkOpen(false); }} onCancel={() => setLinkOpen(false)}
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
