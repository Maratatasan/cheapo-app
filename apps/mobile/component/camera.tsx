import { useCallback, useRef, useState, useEffect, type ReactNode } from "react";
import type { PricePhotoSelection } from "@cheapo/domain/price-history";
import type { AddProductPhotoDetails } from "@/data/photo-price-source";
import type { Product } from "@cheapo/domain";
import { randomUUID } from 'expo-crypto';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  Keyboard,
  Alert,
  Platform,
} from "react-native";
import { captureGuide, fittedCameraFrame, seedGuideCrop, fullPhoto, type CropBox } from "@/data/crop-geometry";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { CameraActionButton, CameraCaptureActions, CameraPermissionActions, CameraSavedDraftActions } from "./camera-actions";
import { useCheapoShopping } from "./cheapo-shopping-provider";
import { DisplayState } from "./results/display-state";
import { ui } from "./results/theme";
import { GalleryCopy } from "./gallery-copy";
import { PhotoReview, type ReviewSuggestion } from "./photo-review";
import { PhotoCrop } from "./photo-crop";
import { PhotoProductLookup } from "./photo-product-lookup";
import type { ProductCandidateLookupProps } from "./product-candidate-lookup";
import type { ProductCandidate } from "@/data/cheapo-shopping-reads";
import { PhotoBarcodeCatalogMatch, PhotoBarcodeMissing, PhotoBarcodeReview } from "./photo-barcode-review";
import { cameraPermissionMessage, PhotoBarcodeScan } from "./photo-barcode-scan";
import { emptyReview, loadLocalPhotos, reviewComplete, saveLocalPhoto, type DraftShop, type LocalPhotoDraft, type ManualReview, type PhotoAsset } from "@/data/local-photo";
import { MobileDraft } from "./mobile-draft";
import { DirectPhotoAnalysis, DirectProductIdentityAnalysis } from "./direct-photo-analysis";
import { fieldPhotoAnalysisEnabled } from "@/lib/direct-auth/phone-session";
import type { PhotoShopCountry } from "@/lib/direct-auth/shop-country";
import { applyPhotoSuggestion, calculatePackUnitPrice, savedProductDetails } from "@/data/photo-review";
import type { EditableCatalogProduct } from "@/data/enrolled-catalog";
import { findCatalogProductByBarcode } from "@/data/exact-barcode";
import { addLocalProduct } from "@/data/local-products";
import { decodePhotoBarcodes, type PhotoBarcodeResult } from "@/data/photo-barcode";
import { canonicalProductBarcode } from "@/data/product-barcode";
import { choosePhoto } from "@/lib/choose-photo";
import { cropPhoto } from "@/lib/photo-crop";
import { readOwnEnrolledPriceEdit } from "@/data/edit-enrolled-price-device";
import { correctionFromReview, saveEnrolledPriceEdit, type PriceEditTarget } from "@/data/edit-enrolled-price";
import type { PhotoSavePending } from "@/data/price-records";
import type { PhotoPriceSource } from "@/data/photo-price-source";
import { usePriceSaveNotice } from "@/hooks/use-price-save-notice";
import { useEnrolledCatalog } from "@/hooks/use-enrolled-catalog";
import { useShelfPhotoEvidence } from "./use-shelf-photo-evidence";

type LinkedPriceCapture = {
  productId: string;
  barcode?: string;
  initialReview: ManualReview;
  sourcePhoto?: PhotoPriceSource;
  product?: Product;
  onCancel: () => void;
  onSaved: (pending?: PhotoSavePending, sourceId?: string) => void;
};

type BarcodeCapture = {
  barcode: string;
  initialReview?: ManualReview;
  onCancel: () => void;
  onSaved: (pending?: PhotoSavePending, sourceId?: string) => void;
};

export type CameraProductLookup = {
  onCompare: (barcode: string, product: Product, draft: LocalPhotoDraft) => void;
  onContinueToPrice?: (details: AddProductPhotoDetails, draft: LocalPhotoDraft) => void;
  onRetake?: () => void;
  candidateLookup?: Omit<ProductCandidateLookupProps, 'onCompare'> & {
    onCompare: (candidate: ProductCandidate, draft: LocalPhotoDraft) => void;
  };
};

type ReviewBarcode = {
  value: string;
  confirmed?: string;
  product?: EditableCatalogProduct;
  used?: boolean;
  checking?: boolean;
  failed?: boolean;
  error?: string;
};

function reviewWithProduct(review: ManualReview, product?: EditableCatalogProduct): ManualReview {
  if (!product) return review;
  const { name, productType, brand, variety, pack } = product;
  const label = pack && (pack.label ?? `${pack.quantity} ${pack.unit}`);
  return { ...review, productName: name, productType, brand, variety,
    packSize: review.packSize ?? (label && calculatePackUnitPrice('1', label) ? label : undefined) };
}

export const CameraComponent = ({ currentShop, currentShopCountry, onScanBarcode, onCompareBarcode, linkedPrice, barcodeCapture, productLookup }: {
  currentShop?: DraftShop;
  currentShopCountry?: PhotoShopCountry;
  onScanBarcode?: () => void;
  onCompareBarcode?: (code: string) => void;
  linkedPrice?: LinkedPriceCapture;
  barcodeCapture?: BarcodeCapture;
  productLookup?: CameraProductLookup;
}) => {
  const shopping = useCheapoShopping();
  const enrolledCatalog = useEnrolledCatalog();
  const findLookupProduct = useCallback((code: string, signal: AbortSignal) =>
    findCatalogProductByBarcode(enrolledCatalog, code, signal), [enrolledCatalog]);
  const lookingUp = Boolean(productLookup);
  const loadPhotos = shopping?.priceRecords.loadPhotos ?? loadLocalPhotos;
  const [captureStage, setCaptureStage] = useState(() => Dimensions.get("window"));
  const captureFrame = fittedCameraFrame(captureStage);
  const [facing, setFacing] = useState<CameraType>("back");
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const editedFields = useRef(new Set<keyof ManualReview>());
  const [draft, setDraft] = useState<LocalPhotoDraft | null>(() => linkedPrice?.sourcePhoto && currentShop ? {
    ...linkedPrice.sourcePhoto, id: randomUUID(), shop: currentShop, productId: linkedPrice.productId,
    review: linkedPrice.initialReview,
  } : null);
  const [cropping, setCropping] = useState(false);
  const [visitShop, setVisitShop] = useState("");
  const [saved, setSaved] = useState(false);
  const [pendingSaveStatus, setPendingSaveStatus] = useState<PhotoSavePending>();
  const [savedCorrection, setSavedCorrection] = useState<string>();
  const [editingSaved, setEditingSaved] = useState<{ target?: PriceEditTarget; available: boolean; productId?: string }>();
  const [editedSelection, setEditedSelection] = useState<PricePhotoSelection>();
  const saveNotice = usePriceSaveNotice(shopping, saved ? draft?.id : undefined, pendingSaveStatus, savedCorrection);
  const [saving, setSaving] = useState(false);
  const [barcode, setBarcode] = useState<ReviewBarcode>(() => {
    const value = barcodeCapture?.barcode.trim() ?? "";
    return { value: canonicalProductBarcode(value) ? value : "" };
  });
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);
  const [decodedBarcodes, setDecodedBarcodes] = useState<{ draftId: string; result: PhotoBarcodeResult }>();
  const [saveError, setSaveError] = useState<string>();
  const [savedPhotos, setSavedPhotos] = useState<LocalPhotoDraft[]>([]);
  const busy = saving;
  const savePending = useRef(false);
  const pendingCatalog = useRef<{ sourceId: string; productId: string; operationId?: string } | undefined>(undefined);
  const barcodeRequest = useRef<AbortController | null>(null);
  const photoCatalog = (!editingSaved || editingSaved.target) ? enrolledCatalog : null;
  const matchedProduct = barcode.used ? barcode.product : undefined;
  const knownProduct = linkedPrice?.product ?? matchedProduct;
  const { photoText: pricePhotoText, shelfEvidence } = useShelfPhotoEvidence(!lookingUp && !cropping ? draft ?? undefined : undefined,
    saved || editingSaved ? undefined : knownProduct);
  const baseReview = reviewWithProduct(draft?.review ?? emptyReview(), matchedProduct);
  const shelfPrice = shelfEvidence?.kind === 'clear' && draft?.shop && !saved && !editingSaved && !baseReview.price.trim() &&
    !editedFields.current.has('price') && !editedFields.current.has('currency') && !editedFields.current.has('packSize') ? shelfEvidence.selling : undefined;
  const currentReview = shelfPrice ? { ...baseReview, price: (shelfPrice.minor / 100).toFixed(2), currency: shelfPrice.currency } : baseReview;
  const checkedCode = barcode.confirmed;
  const openSaved = useRef<AbortController | null>(null);
  useEffect(() => () => openSaved.current?.abort(), [shopping]);
  useEffect(() => {
    setBarcode(current => current.checking || current.confirmed || current.failed ? { value: current.value } : current);
    return () => barcodeRequest.current?.abort();
  }, [photoCatalog]);
  useEffect(() => {
    if (linkedPrice || barcodeCapture || lookingUp) return;
    let active = true;
    loadPhotos().then(photos => {
      if (!active) return;
      setSavedPhotos(photos);
      if (photos[0]?.review?.shop) setVisitShop(photos[0].review.shop);
    }).catch(() => {
      if (active) Alert.alert('Saved photos unavailable', 'Your saved photos could not be read. Try reopening Scan.');
    });
    return () => { active = false; };
  }, [linkedPrice, barcodeCapture, loadPhotos, lookingUp]);
  const barcodePhoto = !linkedPrice && !draft?.productId ? draft?.original.uri : undefined;
  const barcodeDraftId = barcodePhoto ? draft?.id : undefined;
  useEffect(() => {
    if (!barcodeDraftId || !barcodePhoto) return;
    let active = true;
    void decodePhotoBarcodes(barcodePhoto).then(result => {
      if (active) setDecodedBarcodes({ draftId: barcodeDraftId, result });
    });
    return () => { active = false; };
  }, [barcodeDraftId, barcodePhoto]);

  function changeBarcode(value: string) {
    barcodeRequest.current?.abort();
    setBarcode({ value });
    setSaveError(undefined);
  }

  function openBarcodeScan() {
    if (!permission || savePending.current || draft?.productId) return;
    Keyboard.dismiss();
    if (!permission.granted && !permission.canAskAgain) {
      setBarcode(current => ({ ...current, error: cameraPermissionMessage }));
      return;
    }
    setBarcodeScanOpen(true);
  }

  async function confirmBarcode() {
    if (savePending.current || draft?.productId || barcode.checking) return;
    const confirmed = canonicalProductBarcode(barcode.value);
    if (!confirmed) {
      setBarcode({ ...barcode, error: 'Enter a valid product barcode.' });
      return;
    }
    Keyboard.dismiss();
    const value = barcode.value.trim();
    barcodeRequest.current?.abort();
    const request = new AbortController();
    barcodeRequest.current = request;
    setBarcode({ value, checking: true });
    setSaved(false);
    setSaveError(undefined);
    try {
      const product = await findCatalogProductByBarcode(photoCatalog, confirmed, request.signal);
      if (!request.signal.aborted) setBarcode({ value, confirmed, product });
    } catch {
      if (!request.signal.aborted) setBarcode({ value, failed: true, error: 'Could not check this barcode. Try again.' });
    }
  }

  function selectPhoto(photo: PhotoAsset, cropBox?: CropBox) {
    const initialCrop = productLookup ? undefined : cropBox;
    editedFields.current.clear();
    if (barcodeCapture?.initialReview) {
      for (const field of ["productName", "productType", "variety", "brand", "packSize"] as const) {
        if (barcodeCapture.initialReview[field]?.trim()) editedFields.current.add(field);
      }
    }
    changeBarcode(barcodeCapture ? barcode.value : "");
    setSaveError(undefined);
    setPendingSaveStatus(undefined);
    setSavedCorrection(undefined);
    setEditingSaved(undefined);
    setEditedSelection(undefined);
    pendingCatalog.current = undefined;
    setCropping(initialCrop !== undefined);
    setDraft({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, capturedAt: new Date().toISOString(),
      original: photo, selected: photo, review: linkedPrice?.initialReview ?? barcodeCapture?.initialReview ?? emptyReview(currentShop?.displayName ?? visitShop),
      cropBox: initialCrop, shop: currentShop, productId: linkedPrice?.productId });
    setSaved(false);
  }
  async function savePhoto() {
    if (!draft || savePending.current || barcode.checking || barcode.failed || (barcode.product && !matchedProduct)) return;
    const review = draft.review && currentReview;
    const complete = reviewComplete(review, draft.shop?.displayName);
    if ((linkedPrice || matchedProduct || (draft.productId && barcode.confirmed)) && !complete) return;
    if (!barcode.confirmed && barcode.value.trim()) {
      setSaveError('Confirm the barcode to include it, or clear the entry to save without a barcode.');
      return;
    }

    savePending.current = true;
    setSaving(true);
    setSaveError(undefined);
    let pendingDraft: LocalPhotoDraft = { ...draft, review, productId: matchedProduct?.id ?? draft.productId };
    try {
      await shopping?.assertOwner();
      if (editingSaved && !editingSaved.available) {
        setSaveError('Cheapo could not match this saved price. Connect and open it again to save your changes.');
        return;
      }
      if (editingSaved?.target && (!draft.review || !complete)) {
        setSaveError('Enter complete price details before saving this correction.');
        return;
      }
      if (barcode.confirmed && !pendingDraft.productId) {
        if (!review || !complete || !review.productType?.trim()) {
          setSaveError('Enter the product name, type and price to save with this barcode, or clear the barcode to save a photo draft.');
          return;
        }
        const code = barcode.confirmed;
        const showMatch = (product: EditableCatalogProduct) => {
          setBarcode({ value: barcode.value, confirmed: code, product });
        };
        try {
          const product = await findCatalogProductByBarcode(photoCatalog, code);
          if (product) { showMatch(product); return; }
        } catch {
          setBarcode({ value: barcode.value, failed: true, error: 'Could not check this barcode. Try again.' });
          return;
        }
        try {
          const details = { ...savedProductDetails(review), barcode: code };
          let productId: string;
          if (photoCatalog) {
            if (pendingCatalog.current?.sourceId !== draft.id) pendingCatalog.current = { sourceId: draft.id, productId: randomUUID() };
            const candidate = pendingCatalog.current;
            const product = await photoCatalog.save({ ...details, id: candidate.productId });
            candidate.operationId = product.catalogBase?.kind === 'operation' ? product.catalogBase.operationId : undefined;
            productId = product.id;
          } else {
            productId = (await addLocalProduct({ ...details, id: draft.id })).id;
          }
          pendingDraft = { ...draft, productId };
          // Keep the catalog link if photo storage fails so retry can reuse the product.
          setDraft(pendingDraft);
        } catch (error) {
          const product = await findCatalogProductByBarcode(photoCatalog, code).catch(() => undefined);
          if (product) { showMatch(product); return; }
          setSaveError(error instanceof Error ? error.message : 'Couldn’t save the product barcode. Try again.');
          return;
        }
      }
      if (shopping && editingSaved?.target && pendingDraft.review) {
        const dependency = matchedProduct?.catalogBase?.kind === 'operation' ? matchedProduct.catalogBase.operationId
          : pendingCatalog.current?.sourceId === draft.id ? pendingCatalog.current.operationId : undefined;
        const operationId = await saveEnrolledPriceEdit(shopping, editingSaved.target, pendingDraft.review.productName,
          { ...correctionFromReview(pendingDraft.review), ...(editedSelection ? { photoSelection: editedSelection } : {}),
            ...(pendingDraft.productId && pendingDraft.productId !== editingSaved.productId ? { productId: pendingDraft.productId } : {}) },
          dependency ? [dependency] : undefined);
        setEditingSaved({ ...editingSaved, productId: pendingDraft.productId, target: { ...editingSaved.target, base: { kind: 'operation', operationId } } });
        setEditedSelection(undefined);
        setSavedCorrection(operationId);
        setPendingSaveStatus('waiting');
        setSaved(true);
        return;
      }
      const result = shopping && !editingSaved ? await shopping.priceRecords.saveNewPhoto(pendingDraft)
        : { record: await saveLocalPhoto(pendingDraft), pending: undefined };
      await shopping?.assertOwner();
      setDraft(result.record);
      setSaved(true);
      setPendingSaveStatus(result.pending);
      if (result.pending) setEditingSaved({ available: true, target: { priceKey: result.record.id,
        base: { kind: 'append', sourceId: result.record.id } }, productId: result.record.productId });
      setSavedPhotos(current => [result.record, ...current.filter(item => item.id !== result.record.id)]);
      if (result.pending === 'waiting') void shopping?.retry().catch(() => { /* The reviewed photo remains pending. */ });
      (linkedPrice ?? barcodeCapture)?.onSaved(result.pending, result.pending ? result.record.id : undefined);
    } catch {
      if (matchedProduct) {
        setSaveError('Could not save this price. Your photo and details are still here. Try again.');
      } else if (barcode.confirmed && pendingDraft.productId) {
        setSaveError('Product saved. Your photo is kept here. Try saving the price again.');
      } else {
        Alert.alert('Photo not saved', 'Your preview is kept. Check free storage and try Save on this phone again.');
      }
    } finally {
      savePending.current = false;
      setSaving(false);
    }
  }
  const [cameraReady, setCameraReady] = useState(false);
  const [photoAction, setPhotoAction] = useState<"capture" | "choose" | "review" | null>(null);
  const photoPending = useRef(false);
  const savedPhotoButtons = <CameraSavedDraftActions
    drafts={savedPhotos}
    disabled={photoAction !== null}
    onReview={item => { void openSavedPhoto(item); }}
  />;

  async function openSavedPhoto(item: LocalPhotoDraft) {
    if (photoPending.current) return;
    const controller = new AbortController();
    openSaved.current?.abort();
    openSaved.current = controller;
    photoPending.current = true;
    setPhotoAction('review');
    try {
      let draft = item;
      let target: typeof editingSaved;
      let previewError: string | undefined;
      if (shopping && reviewComplete(item.review, item.shop?.displayName)) {
        const edit = await readOwnEnrolledPriceEdit(shopping, item, controller.signal);
        if (controller.signal.aborted) return;
        const { photoSelection } = edit;
        let selected = item.selected;
        if (photoSelection) {
          selected = photoSelection.role === 'original' ? item.original : await cropPhoto(item.original, photoSelection.cropBox).catch(() => {
            previewError = 'Could not preview the revised crop. The original photo is shown.';
            return item.original;
          });
        }
        draft = { ...item, review: edit.record.review, productId: edit.record.productId, shop: edit.record.shop, selected,
          cropBox: photoSelection ? (photoSelection.role === 'crop' ? photoSelection.cropBox : fullPhoto) : item.cropBox };
        if (edit.target || !edit.available) target = { target: edit.target, available: edit.available, productId: edit.record.productId };
      }
      if (controller.signal.aborted) return;
      setSaveError(previewError);
      editedFields.current.clear();
      changeBarcode("");
      setDraft({ ...draft, review: draft.review ?? emptyReview() });
      setVisitShop(draft.review?.shop ?? "");
      setSaved(true);
      setPendingSaveStatus(undefined);
      setSavedCorrection(undefined);
      setEditingSaved(target);
      setEditedSelection(undefined);
      pendingCatalog.current = undefined;
      setCameraReady(false);
    } catch {
      if (!controller.signal.aborted) Alert.alert('Saved price unavailable', 'Your saved photo is still on this phone. Try opening it again.');
    } finally {
      if (openSaved.current === controller) {
        photoPending.current = false;
        if (!controller.signal.aborted) setPhotoAction(null);
      }
    }
  }

  if (photoAction === 'review') return <View style={ui.page}><View style={ui.content}>
    <DisplayState kind="loading" title="Opening saved price" description="Reading its latest details." />
  </View>
  </View>;
  if (!permission) return <View key="loading" style={styles.container} />;

  const useTestPhoto = () => {
    const uri = process.env.EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL;
    if (!uri) {
      Alert.alert(
        "Test photo unavailable",
        "Start the local test-photo server and configure EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL, then restart Expo.",
      );
      return;
    }
    setCameraReady(false);
    Image.getSize(uri, (width, height) => selectPhoto({ uri, width, height, mimeType: 'image/jpeg' }), () => Alert.alert('Test photo unavailable', 'Check the local fixture server and try again.'));
  };
  const testPhotoButton = __DEV__ && !linkedPrice ? (
    <CameraActionButton label="Use test photo" onPress={useTestPhoto} disabled={photoAction !== null} />
  ) : null;
  const barcodeButton = onScanBarcode ? (
    <CameraActionButton label="Scan product barcode" disabled={photoAction !== null} onPress={onScanBarcode} />
  ) : null;
  const captureContext = linkedPrice ?? barcodeCapture;
  const captureCancel = captureContext ? (
    <CameraActionButton label={linkedPrice ? "Back to price entry" : "Back to Add product"}
      disabled={photoAction !== null} onPress={captureContext.onCancel} />
  ) : null;
  const choosePhotoButton = Platform.OS !== "web" ? (
    <CameraActionButton
      label={photoAction === "choose" ? "Opening photos…" : "Choose photo"}
      disabled={photoAction !== null}
      busy={photoAction === "choose"}
      onPress={async () => {
        if (photoPending.current) return;
        photoPending.current = true;
        setPhotoAction("choose");
        try {
          const photo = await choosePhoto();
          if (!photo) return;
          setCameraReady(false);
          selectPhoto(photo, fullPhoto);
        } catch {
          Alert.alert("Photo unavailable", "Choose a different photo and try again.");
        } finally {
          photoPending.current = false;
          setPhotoAction(null);
        }
      }}
    />
  ) : null;

  if (!permission.granted && !draft) {
    return (
      <View key="permission" collapsable={false} style={styles.permissionContainer}>
        <CameraPermissionActions onGrant={requestPermission} disabled={photoAction !== null} choosePhoto={choosePhotoButton}>
          {barcodeButton}
          {captureCancel}
          {testPhotoButton}
          {savedPhotoButtons}
        </CameraPermissionActions>
      </View>
    );
  }

  const takePhoto = async () => {
    if (!cameraReady || photoPending.current || !cameraRef.current) return;

    photoPending.current = true;
    setPhotoAction("capture");

    try {
      const photo = await cameraRef.current.takePictureAsync();
      setCameraReady(false);
      const asset: PhotoAsset = { uri: photo.uri, width: photo.width, height: photo.height, mimeType: "image/jpeg" };
      const initialCrop = Platform.OS === "android" ? seedGuideCrop(asset, captureFrame) : null;
      selectPhoto(asset, initialCrop ?? fullPhoto);
    } catch {
      Alert.alert("Unable to take photo", "Please try again.");
    } finally {
      photoPending.current = false;
      setPhotoAction(null);
    }
  };

  const retakePhoto = () => {
    productLookup?.onRetake?.();
    changeBarcode(barcodeCapture ? barcode.value : "");
    setDraft(null); setSaved(false); setCropping(false);
  };

  if (draft && productLookup) return <PhotoProductLookup key={draft.id} photo={draft.original}
    decoded={decodedBarcodes?.draftId === draft.id ? decodedBarcodes.result : undefined}
    findProduct={findLookupProduct} onCompare={(code, product) => productLookup.onCompare(code, product, draft)} onRetake={retakePhoto}
    onContinueToPrice={productLookup.onContinueToPrice ? details => productLookup.onContinueToPrice?.(details, draft) : undefined}
    candidateLookup={productLookup.candidateLookup ? {
      ...productLookup.candidateLookup,
      onCompare: candidate => productLookup.candidateLookup?.onCompare(candidate, draft),
      renderIdentitySuggestions: fieldPhotoAnalysisEnabled ? (onApply, busy) =>
        <DirectProductIdentityAnalysis photo={draft.original} busy={busy} onApply={onApply} /> : undefined,
    } : undefined} />;

  if (draft && cropping) {
    // Mount the crop modal before mounting the review and its native inputs.
    return <View key="crop" collapsable={false} style={styles.container}>
      <PhotoCrop original={draft.original} initialBox={draft.cropBox}
        onCancel={() => setCropping(false)}
        onApply={(photo, cropBox) => {
          setDraft({ ...draft, selected: photo, cropBox });
          if (editingSaved?.target) setEditedSelection({ role: 'crop', cropBox });
          setSaved(false);
          setCropping(false);
        }}
      />
    </View>;
  }

  if (draft) {
    const renderReview = (controls: ReactNode, suggestion?: ReviewSuggestion) => (
      <PhotoReview
        photo={draft.selected}
        review={currentReview}
        selectedShopName={draft.shop?.displayName}
        saved={saved}
        savedStatus={saveNotice}
        busy={busy}
        onReviewChange={(review, field) => {
          editedFields.current.add(field);
          setDraft({ ...draft, review: { ...(draft.review ?? emptyReview()), [field]: review[field] } });
          setSaved(false);
          setVisitShop(review.shop);
          setSaveError(undefined);
        }}
        galleryAction={<GalleryCopy key={draft.selected.uri} photo={draft.selected} />}
        onSave={savePhoto}
        suggestion={suggestion}
        recordingPrice={Boolean(linkedPrice || matchedProduct || (draft.productId && barcode.confirmed))}
        currentPriceConfirmation={Boolean(linkedPrice?.sourcePhoto || shelfPrice)}
        saveError={saveError}
        saveBlocked={barcode.checking ? 'Finish checking the barcode before saving.'
          : barcode.failed ? 'Retry the barcode lookup, or remove the entry to save without it.'
            : barcode.product && !matchedProduct ? 'Choose whether to use the saved product before saving.' : undefined}
        savedBarcode={linkedPrice?.barcode}
        barcodeReview={!linkedPrice && (!draft.productId || barcode.confirmed) ? (
          <PhotoBarcodeReview result={decodedBarcodes?.draftId === draft.id ? decodedBarcodes.result : undefined}
            value={barcode.value} confirmed={Boolean(checkedCode)} checking={barcode.checking}
            confirmLabel={barcode.failed ? 'Retry barcode lookup' : undefined}
            carried={barcode.value === barcodeCapture?.barcode.trim()} locked={Boolean(draft.productId)} busy={busy}
            error={barcode.error} onChange={changeBarcode} onConfirm={() => { void confirmBarcode(); }} onClear={() => changeBarcode("")}
            onScan={Platform.OS !== "web" ? openBarcodeScan : undefined}>
            {barcode.product ? <PhotoBarcodeCatalogMatch name={barcode.product.name}
                details={[barcode.product.productType, barcode.product.brand, barcode.product.variety, barcode.product.pack?.label].filter(Boolean).join(' · ')}
                selected={Boolean(matchedProduct)} busy={busy} onUse={() => setBarcode(current => ({ ...current, used: true }))}
                onCompare={checkedCode && onCompareBarcode ? () => onCompareBarcode(checkedCode) : undefined} />
              : checkedCode && !draft.productId ? <PhotoBarcodeMissing /> : null}
          </PhotoBarcodeReview>
        ) : undefined}
        onCancel={captureContext?.onCancel}
        onRetake={barcodeCapture && draft.productId ? undefined : retakePhoto}
        onCrop={() => setCropping(true)}
        onOriginal={draft.selected.uri !== draft.original.uri ? () => {
          setDraft({ ...draft, selected: draft.original, cropBox: fullPhoto });
          if (editingSaved?.target) setEditedSelection({ role: 'original' });
          setSaved(false);
        } : undefined}
        onImageError={() => {
          if (draft.selected.uri === process.env.EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL) setDraft(null);
          Alert.alert('Photo unavailable', 'The photo could not be loaded. For the test photo, check the local fixture server and try again.');
        }}
      >
        {controls}
      </PhotoReview>
    );

    return <View key="review" collapsable={false} style={styles.container}>
      {fieldPhotoAnalysisEnabled ? (
        <DirectPhotoAnalysis key={draft.selected.uri} photo={draft.selected} photoText={pricePhotoText} noPriceFound={shelfEvidence?.kind === 'no-price'}
          shopCountry={draft.shop && draft.shop.id === currentShop?.id ? currentShopCountry : undefined}
          busy={busy} onApply={(suggestion) => {
          const review = draft.review ?? emptyReview(draft.shop?.displayName);
          setDraft({
            ...draft,
            review: applyPhotoSuggestion(review, suggestion, editedFields.current, Boolean(linkedPrice || matchedProduct || draft.productId)),
          });
          setSaved(false);
        }}>
          {renderReview}
        </DirectPhotoAnalysis>
      ) : renderReview(__DEV__ ? <MobileDraft key={draft.selected.uri} photoUri={draft.selected.uri} /> : null)}
      {barcodeScanOpen ? (
        <PhotoBarcodeScan permission={permission} requestPermission={requestPermission}
          onCancel={() => setBarcodeScanOpen(false)}
          onRead={code => { changeBarcode(code); setBarcodeScanOpen(false); }}
          onError={error => { setBarcode(current => ({ ...current, error })); setBarcodeScanOpen(false); }} />
      ) : null}
    </View>;
  }

  return (
    <View key="capture" collapsable={false} style={styles.container}>
      <View style={styles.captureStage} onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setCaptureStage(current => width === current.width && height === current.height ? current : { ...current, width, height });
      }}>
        <View style={{ width: captureFrame.width, height: captureFrame.height }}>
          <CameraView style={StyleSheet.absoluteFill} ratio="4:3" facing={facing} ref={cameraRef} onCameraReady={() => setCameraReady(true)} />
          <View pointerEvents="none" style={[styles.captureFrame, { position: 'absolute', left: `${captureGuide.left * 100}%`, top: `${captureGuide.top * 100}%`, width: `${(captureGuide.right - captureGuide.left) * 100}%`, height: `${(captureGuide.bottom - captureGuide.top) * 100}%` }]} />
        </View>
      </View>
      <CameraCaptureActions
        mode={productLookup ? 'product' : 'price'}
        ready={cameraReady}
        capturing={photoAction === "capture"}
        choosing={photoAction === "choose"}
        onCapture={takePhoto}
        onFlip={() => {
          setCameraReady(false);
          setFacing(current => current === "back" ? "front" : "back");
        }}
        choosePhoto={choosePhotoButton}
      >
        {barcodeButton}
        {captureCancel}
        {testPhotoButton}
        {savedPhotoButtons}
      </CameraCaptureActions>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    position: "relative",
  },
  permissionContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  captureStage: { flex: 1, alignItems: "center", justifyContent: "center" },
  captureFrame: { borderWidth: 2, borderColor: "#fff", borderRadius: 14 },

});
