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

export const CameraComponent = () => {
  const [facing, setFacing] = useState<CameraType>("back");
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
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
      </View>
    );
  }

  const takePhoto = async () => {
    if (cameraRef.current) {
      const photo = await cameraRef.current.takePictureAsync();
      setPhotoUri(photo.uri);
    }
  };

  const uploadPhoto = async () => {
    if (!photoUri) return;

    // Stub: Upload to your backend or cloud storage
    console.log("Uploading photo:", photoUri);
    Alert.alert("✅ Photo uploaded!", photoUri);
    setPhotoUri(null); // Reset to camera
  };

  const retakePhoto = () => {
    setPhotoUri(null);
  };

  return (
    <View style={styles.container}>
      {photoUri ? (
        <>
          <Image source={{ uri: photoUri }} style={styles.preview} />
          <SafeAreaView style={styles.overlay}>
            <TouchableOpacity style={styles.button} onPress={uploadPhoto}>
              <Text style={styles.buttonText}>Upload Photo</Text>
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
          />
          <SafeAreaView style={styles.overlay}>
            <TouchableOpacity style={styles.button} onPress={takePhoto}>
              <Text style={styles.buttonText}>Take Picture of Price</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, { marginTop: 12 }]}
              onPress={() => {
                setFacing((current) => (current === "back" ? "front" : "back"));
              }}
            >
              <Text style={styles.buttonText}>Flip Camera</Text>
            </TouchableOpacity>
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
