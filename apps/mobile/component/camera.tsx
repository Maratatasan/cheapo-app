import { useRef, useState, useEffect, type ReactNode } from "react";
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
import { GalleryCopy } from "./gallery-copy";
import { PhotoReview, type ReviewSuggestion } from "./photo-review";
import { PhotoCrop } from "./photo-crop";
import { PhotoBarcodeReview } from "./photo-barcode-review";
import { cameraPermissionMessage, PhotoBarcodeScan } from "./photo-barcode-scan";
import { emptyReview, loadLocalPhotos, reviewComplete, saveLocalPhoto, type DraftShop, type LocalPhotoDraft, type ManualReview, type PhotoAsset } from "@/data/local-photo";
import { MobileDraft } from "./mobile-draft";
import { DirectPhotoAnalysis } from "./direct-photo-analysis";
import { fieldPhotoAnalysisEnabled } from "@/lib/direct-auth/phone-session";
import type { PhotoShopCountry } from "@/lib/direct-auth/shop-country";
import { applyPhotoSuggestion, productPackFromText } from "@/data/photo-review";
import { addLocalProduct } from "@/data/local-products";
import { decodePhotoBarcodes, type PhotoBarcodeResult } from "@/data/photo-barcode";
import { canonicalProductBarcode } from "@/data/product-barcode";
import { choosePhoto } from "@/lib/choose-photo";
import type { PhotoSavePending } from "@/data/price-records";
import { usePriceSaveNotice } from "@/hooks/use-price-save-notice";

type LinkedPriceCapture = {
  productId: string;
  barcode?: string;
  initialReview: ManualReview;
  onCancel: () => void;
  onSaved: (pending?: PhotoSavePending, sourceId?: string) => void;
};

type BarcodeCapture = {
  barcode: string;
  initialReview?: ManualReview;
  onCancel: () => void;
  onSaved: (pending?: PhotoSavePending, sourceId?: string) => void;
};

export const CameraComponent = ({ currentShop, currentShopCountry, onScanBarcode, linkedPrice, barcodeCapture }: {
  currentShop?: DraftShop;
  currentShopCountry?: PhotoShopCountry;
  onScanBarcode?: () => void;
  linkedPrice?: LinkedPriceCapture;
  barcodeCapture?: BarcodeCapture;
}) => {
  const shopping = useCheapoShopping();
  const loadPhotos = shopping?.priceRecords.loadPhotos ?? loadLocalPhotos;
  const [captureStage, setCaptureStage] = useState(() => Dimensions.get("window"));
  const captureFrame = fittedCameraFrame(captureStage);
  const [facing, setFacing] = useState<CameraType>("back");
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const editedFields = useRef(new Set<keyof ManualReview>());
  const [draft, setDraft] = useState<LocalPhotoDraft | null>(null);
  const [cropping, setCropping] = useState(false);
  const [visitShop, setVisitShop] = useState("");
  const [saved, setSaved] = useState(false);
  const [pendingSaveStatus, setPendingSaveStatus] = useState<PhotoSavePending>();
  const saveNotice = usePriceSaveNotice(shopping, saved ? draft?.id : undefined, pendingSaveStatus);
  const [saving, setSaving] = useState(false);
  const [barcode, setBarcode] = useState<{ value: string; confirmed?: string; error?: string }>(() => {
    const value = barcodeCapture?.barcode.trim() ?? "";
    return { value: canonicalProductBarcode(value) ? value : "" };
  });
  const [barcodeScanOpen, setBarcodeScanOpen] = useState(false);
  const [decodedBarcodes, setDecodedBarcodes] = useState<{ draftId: string; result: PhotoBarcodeResult }>();
  const [saveError, setSaveError] = useState<string>();
  const [savedPhotos, setSavedPhotos] = useState<LocalPhotoDraft[]>([]);
  const busy = saving;
  const savePending = useRef(false);
  useEffect(() => {
    if (linkedPrice || barcodeCapture) return;
    let active = true;
    loadPhotos().then(photos => {
      if (!active) return;
      setSavedPhotos(photos);
      if (photos[0]?.review?.shop) setVisitShop(photos[0].review.shop);
    }).catch(() => {
      if (active) Alert.alert('Saved photos unavailable', 'Your saved photos could not be read. Try reopening Scan.');
    });
    return () => { active = false; };
  }, [linkedPrice, barcodeCapture, loadPhotos]);
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

  function confirmBarcode() {
    if (savePending.current || draft?.productId) return;
    const confirmed = canonicalProductBarcode(barcode.value);
    if (!confirmed) {
      setBarcode({ ...barcode, error: 'Enter a valid product barcode.' });
      return;
    }
    setBarcode({ value: barcode.value.trim(), confirmed });
    setSaved(false);
    setSaveError(undefined);
  }

  function selectPhoto(photo: PhotoAsset, cropBox?: CropBox) {
    editedFields.current.clear();
    if (barcodeCapture?.initialReview) {
      for (const field of ["productName", "productType", "variety", "brand", "packSize"] as const) {
        if (barcodeCapture.initialReview[field]?.trim()) editedFields.current.add(field);
      }
    }
    if (!barcodeCapture) changeBarcode("");
    setSaveError(undefined);
    setPendingSaveStatus(undefined);
    setCropping(cropBox !== undefined);
    setDraft({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, capturedAt: new Date().toISOString(),
      original: photo, selected: photo, review: linkedPrice?.initialReview ?? barcodeCapture?.initialReview ?? emptyReview(currentShop?.displayName ?? visitShop),
      cropBox, shop: currentShop, productId: linkedPrice?.productId });
    setSaved(false);
  }
  async function savePhoto() {
    if (!draft || savePending.current) return;
    const complete = reviewComplete(draft.review, draft.shop?.displayName);
    if ((linkedPrice || (draft.productId && barcode.confirmed)) && !complete) return;
    if (!barcode.confirmed && barcode.value.trim()) {
      setSaveError('Confirm the barcode to include it, or clear the entry to save without a barcode.');
      return;
    }

    savePending.current = true;
    setSaving(true);
    setSaveError(undefined);
    let pendingDraft = draft;
    try {
      await shopping?.assertOwner();
      if (barcode.confirmed && !draft.productId) {
        const review = draft.review;
        if (!review || !complete || !review.productType?.trim()) {
          setSaveError('Enter the product name, type and price to save with this barcode, or clear the barcode to save a photo draft.');
          return;
        }
        try {
          const product = await addLocalProduct({
            id: draft.id,
            barcode: barcode.confirmed,
            name: review.productName,
            productType: review.productType,
            variety: review.variety?.trim() || undefined,
            brand: review.brand?.trim() || undefined,
            pack: productPackFromText(review.packSize ?? ''),
          });
          pendingDraft = { ...draft, productId: product.id };
          // Keep the catalog link if photo storage fails so retry can reuse the product.
          setDraft(pendingDraft);
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : 'Couldn’t save the product barcode. Try again.');
          return;
        }
      }
      const previous = shopping && complete ? await shopping.priceRecords.load(draft.id) : null;
      const alreadyReviewed = !!previous && reviewComplete(previous.review, previous.shop?.displayName);
      const result = shopping && !alreadyReviewed ? await shopping.priceRecords.saveNewPhoto(pendingDraft)
        : { record: await saveLocalPhoto(pendingDraft), pending: undefined };
      await shopping?.assertOwner();
      setDraft(result.record);
      setSaved(true);
      setPendingSaveStatus(result.pending);
      setSavedPhotos(current => [result.record, ...current.filter(item => item.id !== result.record.id)]);
      if (result.pending === 'waiting') void shopping?.retry().catch(() => { /* The reviewed photo remains pending. */ });
      (linkedPrice ?? barcodeCapture)?.onSaved(result.pending, result.pending ? result.record.id : undefined);
    } catch {
      if (barcode.confirmed && pendingDraft.productId) {
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
  const [photoAction, setPhotoAction] = useState<"capture" | "choose" | null>(null);
  const photoPending = useRef(false);
  const savedPhotoButtons = <CameraSavedDraftActions
    drafts={savedPhotos}
    disabled={photoAction !== null}
    onReview={item => {
      editedFields.current.clear();
      changeBarcode("");
      setDraft({ ...item, review: item.review ?? emptyReview() });
      setVisitShop(item.review?.shop ?? "");
      setSaved(true);
      setPendingSaveStatus(undefined);
      setCameraReady(false);
    }}
  />;

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
    if (!barcodeCapture) changeBarcode("");
    setDraft(null); setSaved(false); setCropping(false);
  };

  if (draft && cropping) {
    // Mount the crop modal before mounting the review and its native inputs.
    return <View key="crop" collapsable={false} style={styles.container}>
      <PhotoCrop original={draft.original} initialBox={draft.cropBox}
        onCancel={() => setCropping(false)}
        onApply={(photo, cropBox) => {
          setDraft({ ...draft, selected: photo, cropBox });
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
        review={draft.review ?? emptyReview()}
        selectedShopName={draft.shop?.displayName}
        saved={saved}
        savedStatus={saveNotice}
        busy={busy}
        onReviewChange={(review, field) => {
          editedFields.current.add(field);
          setDraft({ ...draft, review });
          setSaved(false);
          setVisitShop(review.shop);
          setSaveError(undefined);
        }}
        galleryAction={<GalleryCopy key={draft.selected.uri} photo={draft.selected} />}
        onSave={savePhoto}
        suggestion={suggestion}
        recordingPrice={Boolean(linkedPrice || (draft.productId && barcode.confirmed))}
        saveError={saveError}
        savedBarcode={linkedPrice?.barcode}
        barcodeReview={!linkedPrice && (!draft.productId || barcode.confirmed) ? (
          <PhotoBarcodeReview result={decodedBarcodes?.draftId === draft.id ? decodedBarcodes.result : undefined}
            value={barcode.value} confirmed={Boolean(barcode.confirmed)}
            carried={barcode.value === barcodeCapture?.barcode.trim()} locked={Boolean(draft.productId)} busy={busy}
            error={barcode.error} onChange={changeBarcode} onConfirm={confirmBarcode} onClear={() => changeBarcode("")}
            onScan={Platform.OS !== "web" ? openBarcodeScan : undefined} />
        ) : undefined}
        onCancel={captureContext?.onCancel}
        onRetake={barcodeCapture && draft.productId ? undefined : retakePhoto}
        onCrop={() => setCropping(true)}
        onOriginal={draft.selected.uri !== draft.original.uri ? () => { setDraft({ ...draft, selected: draft.original, cropBox: fullPhoto }); setSaved(false); } : undefined}
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
        <DirectPhotoAnalysis key={draft.selected.uri} photo={draft.selected}
          shopCountry={draft.shop && draft.shop.id === currentShop?.id ? currentShopCountry : undefined}
          busy={busy} onApply={(suggestion) => {
          const review = draft.review ?? emptyReview(draft.shop?.displayName);
          setDraft({
            ...draft,
            review: applyPhotoSuggestion(review, suggestion, editedFields.current, Boolean(linkedPrice || draft.productId)),
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
