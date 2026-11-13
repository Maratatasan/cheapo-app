import { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  Alert,
  Platform,
} from "react-native";
import { captureGuide, fittedCameraFrame, seedGuideCrop, fullPhoto, type CropBox } from "@/data/crop-geometry";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { CameraActionButton, CameraCaptureActions, CameraPermissionActions, CameraSavedDraftActions } from "./camera-actions";
import { GalleryCopy } from "./gallery-copy";
import { PhotoReview } from "./photo-review";
import { PhotoCrop } from "./photo-crop";
import { emptyReview, loadLocalPhotos, reviewComplete, saveLocalPhoto, type DraftShop, type LocalPhotoDraft, type ManualReview, type PhotoAsset } from "@/data/local-photo";
import { MobileDraft } from "./mobile-draft";
import { DirectPhotoAnalysis } from "./direct-photo-analysis";
import { fieldPhotoAnalysisEnabled } from "@/lib/direct-auth/phone-session";
import { choosePhoto } from "@/lib/choose-photo";

type LinkedPriceCapture = {
  productId: string;
  initialReview: ManualReview;
  onCancel: () => void;
  onSaved: () => void;
};

export const CameraComponent = ({ currentShop, onScanBarcode, linkedPrice }: {
  currentShop?: DraftShop;
  onScanBarcode?: () => void;
  linkedPrice?: LinkedPriceCapture;
}) => {
  const [captureStage, setCaptureStage] = useState(() => Dimensions.get("window"));
  const captureFrame = fittedCameraFrame(captureStage);
  const [facing, setFacing] = useState<CameraType>("back");
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [draft, setDraft] = useState<LocalPhotoDraft | null>(null);
  const [cropping, setCropping] = useState(false);
  const [visitShop, setVisitShop] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPhotos, setSavedPhotos] = useState<LocalPhotoDraft[]>([]);
  const busy = saving;
  const savePending = useRef(false);
  useEffect(() => {
    if (linkedPrice) return;
    loadLocalPhotos().then(photos => { setSavedPhotos(photos); if (photos[0]?.review?.shop) setVisitShop(photos[0].review.shop); }).catch(() => Alert.alert('Saved photos unavailable', 'Your saved photos could not be read. Try reopening Scan.'));
  }, [linkedPrice]);
  function selectPhoto(photo: PhotoAsset, cropBox?: CropBox) {
    setCropping(cropBox !== undefined);
    setDraft({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, capturedAt: new Date().toISOString(),
      original: photo, selected: photo, review: linkedPrice?.initialReview ?? emptyReview(currentShop?.displayName ?? visitShop),
      cropBox, shop: currentShop, productId: linkedPrice?.productId });
    setSaved(false);
  }
  async function persistPhoto(): Promise<LocalPhotoDraft> {
    if (!draft || savePending.current) throw Error("Please wait before saving this photo.");
    savePending.current = true; setSaving(true);
    try {
      const persisted = await saveLocalPhoto(draft);
      setDraft(persisted); setSaved(true);
      setSavedPhotos(current => [persisted, ...current.filter(item => item.id !== persisted.id)]);
      return persisted;
    }
    finally { savePending.current = false; setSaving(false); }
  }
  async function savePhoto() {
    if (linkedPrice && !reviewComplete(draft?.review, currentShop?.displayName)) return;
    try { await persistPhoto(); linkedPrice?.onSaved(); } catch { Alert.alert('Photo not saved', 'Your preview is kept. Check free storage and try Save on this phone again.'); }
  }
  const [cameraReady, setCameraReady] = useState(false);
  const [photoAction, setPhotoAction] = useState<"capture" | "choose" | null>(null);
  const photoPending = useRef(false);
  const savedPhotoButtons = <CameraSavedDraftActions
    drafts={savedPhotos}
    disabled={photoAction !== null}
    onReview={item => {
      setDraft({ ...item, review: item.review ?? emptyReview() });
      setVisitShop(item.review?.shop ?? "");
      setSaved(true);
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
  const linkedCancel = linkedPrice ? (
    <CameraActionButton label="Back to price entry" disabled={photoAction !== null} onPress={linkedPrice.onCancel} />
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
          {linkedCancel}
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

  return (
    <View key={draft ? "review" : "capture"} collapsable={false} style={styles.container}>
      {draft ? (
        <PhotoReview
          photo={draft.selected}
          review={draft.review ?? emptyReview()}
          selectedShopName={draft.shop?.displayName}
          saved={saved}
          busy={busy}
          onReviewChange={review => { setDraft({ ...draft, review }); setSaved(false); setVisitShop(review.shop); }}
          galleryAction={<GalleryCopy key={draft.selected.uri} photo={draft.selected} />}
          onSave={savePhoto}
          recordingPrice={!!linkedPrice}
          onCancel={linkedPrice?.onCancel}
          onRetake={retakePhoto}
          onCrop={() => setCropping(true)}
          onOriginal={draft.selected.uri !== draft.original.uri ? () => { setDraft({ ...draft, selected: draft.original, cropBox: fullPhoto }); setSaved(false); } : undefined}
          onImageError={() => {
            if (draft.selected.uri === process.env.EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL) setDraft(null);
            Alert.alert('Photo unavailable', 'The photo could not be loaded. For the test photo, check the local fixture server and try again.');
          }}
        >
          {fieldPhotoAnalysisEnabled ? (
            <DirectPhotoAnalysis key={draft.selected.uri} photo={draft.selected} busy={busy} onApply={(suggestion) => {
              const review = draft.review ?? emptyReview(draft.shop?.displayName);
              setDraft({
                ...draft,
                review: {
                  ...review,
                  productName: linkedPrice ? review.productName : suggestion.product ?? review.productName,
                  productType: linkedPrice ? review.productType : suggestion.productType ?? review.productType,
                  variety: linkedPrice ? review.variety : suggestion.variety ?? review.variety,
                  brand: linkedPrice ? review.brand : suggestion.brand ?? review.brand,
                  packSize: review.packSize ?? suggestion.packSize ?? undefined,
                  price: suggestion.price?.toString() ?? review.price,
                  currency: suggestion.currency ?? review.currency,
                  unitPrice: suggestion.unit_price?.amount.toString() ?? review.unitPrice,
                  unit: suggestion.unit_price?.unit ?? review.unit,
                },
              });
              setSaved(false);
            }} />
          ) : __DEV__ ? <MobileDraft key={draft.selected.uri} photoUri={draft.selected.uri} /> : null}
        </PhotoReview>
      ) : (
        <>
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
            {linkedCancel}
            {testPhotoButton}
            {savedPhotoButtons}
          </CameraCaptureActions>
        </>
      )}
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
