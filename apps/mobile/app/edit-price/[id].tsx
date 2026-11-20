import { useEffect, useMemo, useRef, useState } from 'react';
import type { PriceObservationDetail } from '@cheapo/domain/price-history';
import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useCameraPermissions } from 'expo-camera';
import { Platform, Text, View } from 'react-native';

import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { CameraActionButton } from '@/component/camera-actions';
import { PhotoBarcodeScan } from '@/component/photo-barcode-scan';
import { SavedPriceBarcode } from '@/component/saved-price-barcode';
import { PhotoReview } from '@/component/photo-review';
import { ProductPhotoEditor } from '@/component/product-photo-editor';
import { RecordedPriceError } from '@/component/recorded-price-error';
import { DisplayState } from '@/component/results/display-state';
import { ui } from '@/component/results/theme';
import { linkSavedPriceToBarcode, loadSavedPriceRecord, saveLocalPhotoReview } from '@/data/local-photo';
import { openCheapoSavedPriceReads } from '@/data/cheapo-shopping-read-device';
import { cheapoShoppingReadCache } from '@/data/cheapo-shopping-read-cache';
import {
  correctionFromReview, readEnrolledPriceEdit, recordFromObservation, saveEnrolledPriceEdit,
  type PriceEditRecord, type PriceEditTarget,
} from '@/data/edit-enrolled-price';
import { firstSyncSavedPrice, readOwnEnrolledPriceEdit } from '@/data/edit-enrolled-price-device';
import { findLocalProductByBarcode, findLocalProductById } from '@/data/local-products';
import { decodePhotoBarcodes } from '@/data/photo-barcode';
import { openProductPresentationPhotos } from '@/data/product-presentation-photos-device';
import { reviewComplete, type ManualReview } from '@/data/photo-review';
import type { PhotoSavePending } from '@/data/price-records';
import { keptSharedPrice, projectSharedPrice } from '@/data/saved-price-history';
import { useEnrolledCatalog } from '@/hooks/use-enrolled-catalog';
import { usePriceSaveNotice } from '@/hooks/use-price-save-notice';
import { chooseProductPhoto } from '@/lib/choose-product-photo';

type EditableProduct = PriceEditRecord & { review: ManualReview };
type EditorData = { product: EditableProduct | null; target?: PriceEditTarget; errorReason?: string;
  observation?: PriceObservationDetail; available?: boolean };

export default function EditSavedPrice() {
  const router = useRouter();
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const shopping = useCheapoShopping();
  const enrolledCatalog = useEnrolledCatalog();
  const [loaded, setLoaded] = useState<{ id: string; source?: string; shopping: typeof shopping; data: EditorData }>();
  const current = loaded?.id === id && loaded.source === source && loaded.shopping === shopping ? loaded.data : undefined;
  const product = current?.product;
  const [review, setReview] = useState<ManualReview>();
  const [busy, setBusy] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [canonicalProductId, setCanonicalProductId] = useState<string>();
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);
  const [linkedBarcode, setLinkedBarcode] = useState<{ code: string; saved?: boolean }>();
  const [linkProgress, setLinkProgress] = useState<{ pending: PhotoSavePending; operationId?: string }>();
  const barcodeLinkStatus = usePriceSaveNotice(shopping, linkProgress ? id : undefined, linkProgress?.pending, linkProgress?.operationId);
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const lifecycle = useRef<AbortController | null>(null);
  const photoLifecycle = useRef<AbortController | null>(null);
  const pendingProduct = useRef<{ barcode: string; id: string } | undefined>(undefined);
  usePreventRemove(linkSaving || photoSaving);
  const presentationPhotos = useMemo(() => shopping && canonicalProductId ? openProductPresentationPhotos(shopping.owner) : null,
    [canonicalProductId, shopping]);

  useEffect(() => {
    const controller = new AbortController();
    const initialPhoto = new AbortController();
    lifecycle.current = controller;
    photoLifecycle.current = initialPhoto;
    const stopClear = source === 'shared' ? cheapoShoppingReadCache.subscribeClear(() => {
      photoLifecycle.current?.abort();
      photoLifecycle.current = new AbortController();
      setLoaded(state => state?.data.product ? { ...state, data: { ...state.data, product: {
        ...state.data.product, original: undefined, selected: undefined,
      } } } : state);
    }) : undefined;
    const { signal } = controller;
    const show = (data: EditorData) => {
      if (signal.aborted) return;
      setLinkOpen(false);
      setLinkSaving(false);
      setLinkedBarcode(undefined);
      setCanonicalProductId(undefined);
      setLinkProgress(undefined);
      pendingProduct.current = undefined;
      setError(undefined);
      setLoaded({ id, source, shopping, data });
      setReview(data.product?.review);
    };

    async function showExistingBarcode(productId: string | undefined, shared: boolean) {
      if (!productId) return;
      const canonical = await enrolledCatalog?.findById(productId, signal).catch(() => undefined);
      if (signal.aborted) return;
      if (canonical?.id === productId && canonical.catalogBase?.kind === 'version') setCanonicalProductId(productId);
      const linked = canonical ?? (!shared ? await findLocalProductById(productId).catch(() => undefined) : undefined);
      if (!signal.aborted && linked?.barcode) setLinkedBarcode({ code: linked.barcode });
    }

    async function load() {
      if (source === 'shared') {
        if (!shopping) return show({ product: null });
        const reads = await openCheapoSavedPriceReads(shopping.owner);
        const [result, changes] = await Promise.all([reads.loadPriceObservation(id, signal), shopping.loadPriceChanges()]);
        const current = result.status === 'unavailable' ? undefined : result.value.observation;
        const observation = current ?? (result.status !== 'fresh' ? keptSharedPrice(id, changes) : undefined);
        if (!observation || signal.aborted) return show({ product: null });
        const { record, target, errorReason } = await readEnrolledPriceEdit(shopping, recordFromObservation(observation), observation);
        if (!record.review) return show({ product: null });
        reads.assertCurrent();
        const displayed = projectSharedPrice(observation, changes).display;
        show({ product: { ...record, review: record.review }, target, errorReason, observation: displayed });
        void showExistingBarcode(record.productId, true);
        const role = displayed.selectedPhotoRole;
        if (role && !initialPhoto.signal.aborted) {
          const photo = await reads.loadSelectedPhoto(displayed, role, initialPhoto.signal).catch(() => undefined);
          reads.assertCurrent();
          if (!signal.aborted && !initialPhoto.signal.aborted && photo && photo.status !== 'unavailable') {
            const { uri, width, height } = photo.value;
            const asset = { uri, width, height, mimeType: 'image/jpeg' as const };
            setLoaded(state => state?.data.product ? { ...state, data: { ...state.data, product: {
              ...state.data.product, selected: asset, ...(role === 'original' ? { original: asset } : {}),
            } } } : state);
          }
        }
        return;
      }

      await shopping?.assertOwner();
      const draft = await (shopping?.priceRecords.load(id) ?? loadSavedPriceRecord(id));
      if (!draft?.review || !reviewComplete(draft.review, draft.shop?.displayName)) return show({ product: null });
      const edit = shopping ? await readOwnEnrolledPriceEdit(shopping, draft, signal) : { record: draft };
      const { record } = edit;
      if (!record.review) return show({ product: null });
      show({ ...edit, product: { ...record, review: record.review } });
      void showExistingBarcode(record.productId, Boolean(shopping && 'target' in edit && edit.target));
    }

    if (Platform.OS !== 'web') void load().catch(() => show({ product: null }));
    return () => {
      controller.abort();
      photoLifecycle.current?.abort();
      stopClear?.();
      photoLifecycle.current = null;
      lifecycle.current = null;
    };
  }, [enrolledCatalog, id, shopping, source]);

  function leave() {
    if (linkSaving || photoSaving) return;
    if (router.canGoBack()) router.back();
    else router.replace('/saved-products');
  }

  async function save() {
    const signal = lifecycle.current?.signal;
    if (!signal || saving.current || photoSaving || linkOpen || !product || !review || product.id !== id || !reviewComplete(review, product.shop?.displayName)) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (shopping && current?.target) await saveEnrolledPriceEdit(shopping, current.target, review.productName, correctionFromReview(review));
      else if (shopping && current?.available === true) {
        if (product.productId) {
          if (!enrolledCatalog) throw Error('Open Cheapo access before syncing this price.');
          const saved = await enrolledCatalog.findById(product.productId, signal);
          if (!saved) {
            const original = await findLocalProductById(product.productId);
            if (!original) throw Error('The saved product is unavailable.');
            await enrolledCatalog.save(original);
          }
        }
        await firstSyncSavedPrice(shopping, { ...product, review });
      }
      else if (source === 'shared' || current?.available === false) throw Error('The shared price needs to be checked again.');
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

  async function openBarcodeLink() {
    setLinkOpen(true);
    const observation = current?.observation;
    const signal = photoLifecycle.current?.signal;
    if (!signal || !shopping || product?.original || !observation) return;
    try {
      const reads = await openCheapoSavedPriceReads(shopping.owner);
      const photo = await reads.loadSelectedPhoto(observation, 'original', signal);
      reads.assertCurrent();
      if (signal.aborted || photo.status === 'unavailable') return;
      const { uri, width, height } = photo.value;
      setLoaded(state => state?.data.product ? { ...state, data: { ...state.data, product: {
        ...state.data.product, original: { uri, width, height, mimeType: 'image/jpeg' },
      } } } : state);
    } catch { /* Barcode entry and scanning remain available without the original. */ }
  }

  async function linkEnrolledBarcode(recordId: string, code: string, target: Parameters<typeof linkSavedPriceToBarcode>[2]) {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted || !shopping || !enrolledCatalog || (!current?.target && current?.available !== true) || !product || product.id !== recordId) {
      throw Error('Open the saved price again before linking a barcode.');
    }
    const matched = await enrolledCatalog.findByBarcode(code, signal);
    let linked = matched;
    if (target.kind === 'existing') {
      if (!matched || matched.id !== target.productId) throw Error('This barcode match changed. Check it again.');
    } else {
      if (pendingProduct.current?.barcode !== code) pendingProduct.current = { barcode: code, id: randomUUID() };
      const productId = pendingProduct.current.id;
      if (matched && matched.id !== productId) throw Error('This barcode is now linked to a product. Check it again.');
      linked = matched ?? await enrolledCatalog.save({ ...target.details, id: productId, barcode: code });
    }
    if (!linked || signal.aborted) throw Error('Open the saved price again before linking a barcode.');
    const productId = linked.id;
    let nextTarget: PriceEditTarget;
    let linkProgress: { pending: PhotoSavePending; operationId?: string };
    if (current.target) {
      const waitFor = linked.catalogBase?.kind === 'operation' ? [linked.catalogBase.operationId] : undefined;
      const operationId = await saveEnrolledPriceEdit(shopping, current.target, product.review.productName,
        { ...correctionFromReview(product.review), productId }, waitFor);
      nextTarget = { ...current.target, base: { kind: 'operation', operationId } };
      linkProgress = { pending: 'waiting', operationId };
    } else {
      const first = await firstSyncSavedPrice(shopping, { ...product, productId });
      nextTarget = first.target;
      linkProgress = { pending: first.pending };
    }
    if (!signal.aborted) {
      if (linked.catalogBase?.kind === 'version') setCanonicalProductId(productId);
      setLinkProgress(linkProgress);
      setLoaded(state => state?.data.product ? { ...state, data: { ...state.data,
        product: { ...state.data.product, productId }, target: nextTarget,
      } } : state);
    }
    return { product: linked };
  }

  const sharedLink = Boolean(shopping && (current?.target || current?.available === true) && enrolledCatalog);
  const canLink = !product?.productId && (!shopping || sharedLink)
    && Boolean(product?.original || sharedLink && current?.observation?.photos.some(photo => photo.role === 'original'));

  async function changeErrorStatus(reason: string | null) {
    const signal = lifecycle.current?.signal;
    if (!signal || saving.current || linkOpen || !shopping || !product || !current?.target) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const operationId = await saveEnrolledPriceEdit(shopping, current.target, product.review.productName, reason === null
        ? { action: 'undo_recorded_in_error' } : { action: 'record_in_error', reason });
      if (!signal.aborted) setLoaded(state => state?.data.target ? { ...state, data: { ...state.data,
        target: { ...state.data.target, base: { kind: 'operation', operationId } }, errorReason: reason ?? undefined,
      } } : state);
    } catch {
      if (!signal.aborted) setError('Could not save this status. Try again.');
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
          saved={false} busy={busy || linkSaving || photoSaving} onReviewChange={setReview} onCancel={linkOpen ? () => setLinkOpen(false) : leave} onSave={save} saveError={error}
          saveBlocked={linkOpen ? 'Save or cancel the barcode link first.' : undefined}
          leadContent={presentationPhotos && canonicalProductId && canonicalProductId === product.productId ? (
            <ProductPhotoEditor key={canonicalProductId} productId={canonicalProductId} photos={presentationPhotos}
              choose={chooseProductPhoto} subscribeClear={cheapoShoppingReadCache.subscribeClear}
              onSavingChange={setPhotoSaving} disabled={busy || linkOpen || linkSaving} />
          ) : shopping ? <Text style={ui.small}>{product.productId
            ? 'Check the shared product before editing its photo.' : 'Link an exact product before adding its shared photo.'}</Text> : null}
          savedBarcode={linkedBarcode?.code} barcodeLinkSaved={linkedBarcode?.saved} barcodeLinkStatus={barcodeLinkStatus}
          barcodeReview={(linkOpen || canLink && !linkedBarcode) && current?.available !== false ? (
            linkOpen ? <SavedPriceBarcode key={product.id} record={product}
              lookup={sharedLink && enrolledCatalog ? code => enrolledCatalog.findByBarcode(code, lifecycle.current?.signal) : findLocalProductByBarcode}
              readPhoto={decodePhotoBarcodes} link={sharedLink ? linkEnrolledBarcode : linkSavedPriceToBarcode}
              disabled={busy} onSavingChange={setLinkSaving}
              onLinked={code => { setLinkedBarcode({ code, saved: true }); setLinkOpen(false); }} onCancel={() => setLinkOpen(false)}
              renderScanner={permission ? callbacks => <PhotoBarcodeScan permission={permission}
                requestPermission={requestPermission} {...callbacks} /> : undefined} />
              : <CameraActionButton label="Link barcode" disabled={busy} onPress={() => { void openBarcodeLink(); }} />
          ) : undefined}>
          {shopping && current?.target && !linkOpen ? <RecordedPriceError key={product.id} reason={current.errorReason}
            busy={busy || linkSaving || photoSaving} onRecord={reason => { void changeErrorStatus(reason); }} onUndo={() => { void changeErrorStatus(null); }} /> : null}
        </PhotoReview>
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
