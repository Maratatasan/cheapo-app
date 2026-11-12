import { View, StyleSheet } from "react-native";
import { CameraComponent } from "@/component/camera";

export default function ScanScreen() {
  return (
    <View style={styles.container}>
      <CameraComponent />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
});
