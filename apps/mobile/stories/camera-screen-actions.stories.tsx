import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn } from "storybook/test";
import { CameraActionButton, CameraCaptureActions, CameraPermissionActions, CameraSavedDraftActions } from "../component/camera-actions";

const meta = {
  title: "Screens/Camera screen actions",
  parameters: { layout: "fullscreen", componentLibraryFrame: false },
} satisfies Meta;
export default meta;

const savedDrafts = [
  { id: "1", capturedAt: "2026-11-12T15:10:00Z" },
  { id: "2", capturedAt: "2026-11-12T15:05:00Z" },
  { id: "3", capturedAt: "2026-11-11T13:20:00Z" },
  { id: "4", capturedAt: "2026-11-11T13:00:00Z" },
];

function CameraExample({ startWithPermission = true, ready = true, showDrafts = false }: {
  startWithPermission?: boolean;
  ready?: boolean;
  showDrafts?: boolean;
}) {
  const [hasPermission, setHasPermission] = useState(startWithPermission);
  const [capturing, setCapturing] = useState(false);
  const choosePhoto = <CameraActionButton label="Choose photo" onPress={fn()} disabled={capturing} />;
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 740 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } }}>
      <View style={styles.screen}>
        {hasPermission ? <>
          <View style={styles.preview}>
            <View style={styles.frame}><Text style={styles.caption}>Camera preview is mocked</Text></View>
          </View>
          <CameraCaptureActions
            ready={ready}
            capturing={capturing}
            choosing={false}
            onCapture={() => setCapturing(true)}
            onFlip={fn()}
            choosePhoto={choosePhoto}
          >
            {showDrafts ? <CameraSavedDraftActions drafts={savedDrafts} disabled={capturing} onReview={fn()} /> : null}
          </CameraCaptureActions>
        </> : (
          <View style={styles.permission}>
            <CameraPermissionActions onGrant={() => setHasPermission(true)} choosePhoto={choosePhoto} disabled={false} />
          </View>
        )}
      </View>
    </SafeAreaProvider>
  );
}

export const Ready: StoryObj = { render: () => <CameraExample /> };
export const PermissionRequired: StoryObj = { render: () => <CameraExample startWithPermission={false} /> };
export const WithSavedDrafts: StoryObj = { render: () => <CameraExample showDrafts /> };
export const Preparing: StoryObj = { render: () => <CameraExample ready={false} /> };

export const PermissionToCapture: StoryObj = {
  render: () => <CameraExample startWithPermission={false} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Grant Permission" }));
    await userEvent.click(canvas.getByRole("button", { name: "Take Picture of Price" }));
    await expect(canvas.getByRole("button", { name: "Taking picture…" })).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByRole("button", { name: "Choose photo" })).toHaveAttribute("aria-disabled", "true");
  },
};

const styles = StyleSheet.create({
  screen: { width: "100%", maxWidth: 520, height: 720, backgroundColor: "#000" },
  preview: { flex: 1, justifyContent: "center", padding: 22, backgroundColor: "#202823" },
  frame: { minHeight: 160, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff", borderRadius: 14 },
  caption: { color: "#fff", textAlign: "center", fontSize: 14 },
  permission: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
});
