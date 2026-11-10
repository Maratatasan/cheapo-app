import { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Image,
  Alert,
} from "react-native";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import { SafeAreaView } from "react-native-safe-area-context";
import { MobileDraft } from "./mobile-draft";

export const CameraComponent = () => {
  const [facing, setFacing] = useState<CameraType>("back");
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [isTakingPhoto, setIsTakingPhoto] = useState(false);
  const isTakingPhotoRef = useRef(false);

  if (!permission) return <View style={styles.container} />;

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
    setPhotoUri(uri);
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

  if (!permission.granted && !photoUri) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.message}>
          We need your permission to show the camera
        </Text>
        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionText}>Grant Permission</Text>
        </TouchableOpacity>
        {testPhotoButton}
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
      setPhotoUri(photo.uri);
    } catch {
      Alert.alert("Unable to take photo", "Please try again.");
    } finally {
      isTakingPhotoRef.current = false;
      setIsTakingPhoto(false);
    }
  };

  const retakePhoto = () => {
    setPhotoUri(null);
  };

  return (
    <View style={styles.container}>
      {photoUri ? (
        <>
          <Image
            source={{ uri: photoUri }}
            accessibilityLabel="Price photo preview"
            style={styles.preview}
            onError={() => {
              if (photoUri === process.env.EXPO_PUBLIC_CHEAPO_TEST_PHOTO_URL) setPhotoUri(null);
              Alert.alert(
                "Photo unavailable",
                "The photo could not be loaded. For the test photo, check that the local fixture server is running, then try again.",
              );
            }}
          />
          <SafeAreaView style={styles.overlay}>
            {__DEV__ ? (
              <MobileDraft photoUri={photoUri} />
            ) : null}
            <TouchableOpacity style={[styles.button, {opacity:0.6}]} disabled accessibilityRole="button">
              <Text style={styles.buttonText}>Saving not connected</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { marginTop: 12 }]}
              onPress={retakePhoto}
            >
              <Text style={styles.buttonText}>Retake</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </>
      ) : (
        <>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing={facing}
            ref={cameraRef}
            onCameraReady={() => setCameraReady(true)}
          />
          <SafeAreaView style={styles.overlay}>
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
            {testPhotoButton}
          </SafeAreaView>
        </>
      )}
    </View>
  );
};

const { width, height } = Dimensions.get("window");

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
  overlay: {
    position: "absolute",
    bottom: 40,
    width: width,
    alignItems: "center",
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
  preview: {
    width,
    height,
    resizeMode: "cover",
  },
});
