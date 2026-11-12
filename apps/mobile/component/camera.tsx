import { useRef, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Image,
  Alert,
  Button,
  ScrollView,
  Platform,
} from "react-native";
import { captureGuide, fittedCameraFrame, seedGuideCrop, fullPhoto, type CropBox } from "@/data/crop-geometry";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { GalleryCopy } from "./gallery-copy";
import { PhotoReview } from "./photo-review";
import { PhotoCrop } from "./photo-crop";
import { emptyReview, loadLocalPhotos, saveLocalPhoto, type DraftShop, type LocalPhotoDraft, type PhotoAsset } from "@/data/local-photo";
import { MobileDraft } from "./mobile-draft";
import { DirectPhotoAnalysis } from "./direct-photo-analysis";
import { fieldPhotoAnalysisEnabled } from "@/lib/direct-auth/phone-session";
import { choosePhoto } from "@/lib/choose-photo";

export const CameraComponent = ({ currentShop }: { currentShop?: DraftShop }) => {
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
  useEffect(() => { loadLocalPhotos().then(photos => { setSavedPhotos(photos); if (photos[0]?.review?.shop) setVisitShop(photos[0].review.shop); }).catch(() => Alert.alert('Saved photos unavailable', 'Your saved photos could not be read. Try reopening Scan.')); }, []);
  function selectPhoto(photo: PhotoAsset, cropBox?: CropBox) {
    setCropping(cropBox !== undefined);
    setDraft({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, capturedAt: new Date().toISOString(), original: photo, selected: photo, review: emptyReview(currentShop?.displayName ?? visitShop), cropBox, shop: currentShop });
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
    try { await persistPhoto(); } catch { Alert.alert('Photo not saved', 'Your preview is kept. Check free storage and try Save on this phone again.'); }
  }
  const savedPhotoButtons = savedPhotos.length ? <ScrollView style={{ maxHeight: 90, marginTop: 12 }}><Text style={styles.buttonText}>Saved in Cheapo ({savedPhotos.length})</Text>{savedPhotos.map(item => <Button key={item.id} title={`Review ${new Date(item.capturedAt).toLocaleString()}`} onPress={() => { setDraft({ ...item, review: item.review ?? emptyReview() }); setVisitShop(item.review?.shop ?? ""); setSaved(true); setCameraReady(false); }} />)}</ScrollView> : null;
  const [cameraReady, setCameraReady] = useState(false);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const isTakingPhotoRef = useRef(false);

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
  const testPhotoButton = __DEV__ ? (
    <TouchableOpacity
      style={[styles.button, { marginTop: 12 }]}
      onPress={useTestPhoto}
      disabled={isTakingPhoto}
      accessibilityRole="button"
    >
      <Text style={styles.buttonText}>Use test photo</Text>
    </TouchableOpacity>
  ) : null;
  const choosePhotoButton = Platform.OS !== "web" ? (
    <TouchableOpacity
      style={styles.button}
      onPress={async () => {
        if (isTakingPhotoRef.current) return;
        isTakingPhotoRef.current = true;
        setIsTakingPhoto(true);
        try {
          const photo = await choosePhoto();
          if (!photo) return;
          setCameraReady(false);
          selectPhoto(photo, fullPhoto);
        } catch {
          Alert.alert("Photo unavailable", "Choose a different photo and try again.");
        } finally {
          isTakingPhotoRef.current = false;
          setIsTakingPhoto(false);
        }
      }}
      disabled={isTakingPhoto}
      accessibilityRole="button"
    >
      <Text style={styles.buttonText}>Choose photo</Text>
    </TouchableOpacity>
  ) : null;

  if (!permission.granted && !draft) {
    return (
      <View key="permission" collapsable={false} style={styles.permissionContainer}>
        <Text style={styles.message}>
          We need your permission to show the camera
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionText}>Grant Permission</Text>
        </TouchableOpacity>
        {choosePhotoButton}
        {testPhotoButton}
        {savedPhotoButtons}
      </View>
    );
  }

  const takePhoto = async () => {
    if (!cameraReady || isTakingPhotoRef.current || !cameraRef.current) return;

    isTakingPhotoRef.current = true;
    setIsTakingPhoto(true);

    try {
      const photo = await cameraRef.current.takePictureAsync();
      setCameraReady(false);
      const asset: PhotoAsset = { uri: photo.uri, width: photo.width, height: photo.height, mimeType: "image/jpeg" };
      const initialCrop = Platform.OS === "android" ? seedGuideCrop(asset, captureFrame) : null;
      selectPhoto(asset, initialCrop ?? fullPhoto);
    } catch {
      Alert.alert("Unable to take photo", "Please try again.");
    } finally {
      isTakingPhotoRef.current = false;
      setIsTakingPhoto(false);
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
                  productName: suggestion.product ?? review.productName,
                  productType: suggestion.productType ?? review.productType,
                  variety: suggestion.variety ?? review.variety,
                  brand: suggestion.brand ?? review.brand,
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
          <SafeAreaView edges={['bottom']} style={styles.captureFooter}>
            <Text style={styles.captureGuideText}>Fit product name, price and weight/size inside the frame.</Text>
            <Text style={styles.captureGuideText}>The full original is kept. Adjust the crop after capture.</Text>
            <TouchableOpacity
              style={styles.button}
              onPress={takePhoto}
              disabled={!cameraReady || isTakingPhoto}
            >
              <Text style={styles.buttonText}>
                {!cameraReady
                  ? "Preparing camera…"
                  : isTakingPhoto
                    ? "Taking picture…"
                    : "Take Picture of Price"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { marginTop: 12 }]}
              disabled={isTakingPhoto}
              onPress={() => {
                setCameraReady(false);
                setFacing((current) => (current === "back" ? "front" : "back"));
              }}
            >
              <Text style={styles.buttonText}>Flip Camera</Text>
            </TouchableOpacity>
            {choosePhotoButton}
            {testPhotoButton}
            {savedPhotoButtons}
          </SafeAreaView>
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
  message: {
    fontSize: 16,
    marginBottom: 16,
    textAlign: "center",
    color: "#fff",
  },
  permissionButton: {
    backgroundColor: "#fff",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  permissionText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#000",
  },
  button: {
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 18,
    color: "white",
    fontWeight: "bold",
  },
  captureStage: { flex: 1, alignItems: "center", justifyContent: "center" },
  captureFooter: { paddingHorizontal: 16, paddingTop: 8, alignItems: "center", gap: 6 },
  captureFrame: { borderWidth: 2, borderColor: "#fff", borderRadius: 14 },
  captureGuideText: { color: "#fff", backgroundColor: "rgba(0,0,0,0.65)", padding: 8, borderRadius: 8, textAlign: "center", fontSize: 14 },

});
