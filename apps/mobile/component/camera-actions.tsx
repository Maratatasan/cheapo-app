import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { marketColor, spacing } from "./results/theme";

type ActionProps = {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  busy?: boolean;
};

export function CameraActionButton({ label, onPress, primary, disabled, busy }: ActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-busy={busy}
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primary,
        (disabled || busy) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

export function CameraSavedDraftActions<Draft extends { id: string; capturedAt: string }>({ drafts, disabled, onReview }: {
  drafts: readonly Draft[];
  disabled?: boolean;
  onReview: (draft: Draft) => void;
}) {
  if (!drafts.length) return null;
  return (
    <ScrollView style={styles.savedPhotos} contentContainerStyle={styles.savedContent}>
      <Text style={styles.savedLabel}>Saved in Cheapo ({drafts.length})</Text>
      {drafts.map(draft => (
        <CameraActionButton
          key={draft.id}
          label={`Review ${new Date(draft.capturedAt).toLocaleString()}`}
          disabled={disabled}
          onPress={() => onReview(draft)}
        />
      ))}
    </ScrollView>
  );
}

export function CameraPermissionActions({ onGrant, choosePhoto, disabled, children }: {
  onGrant: () => void;
  choosePhoto?: ReactNode;
  disabled: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={styles.permission}>
      <Text style={styles.guide}>We need your permission to show the camera</Text>
      <CameraActionButton primary label="Grant Permission" onPress={onGrant} disabled={disabled} />
      {choosePhoto}
      {children}
    </View>
  );
}

export function CameraCaptureActions({ ready, capturing, choosing, onCapture, onFlip, choosePhoto, children }: {
  ready: boolean;
  capturing: boolean;
  choosing: boolean;
  onCapture: () => void;
  onFlip: () => void;
  choosePhoto?: ReactNode;
  children?: ReactNode;
}) {
  const photoPending = capturing || choosing;
  return (
    <SafeAreaView edges={["bottom"]} style={styles.footer}>
      <Text style={styles.guide}>Fit product name, price and weight/size inside the frame.</Text>
      <Text style={styles.guide}>The full original is kept. Adjust the crop after capture.</Text>
      <CameraActionButton
        primary
        label={capturing ? "Taking picture…" : ready ? "Take Picture of Price" : "Preparing camera…"}
        onPress={onCapture}
        disabled={!ready || photoPending}
        busy={capturing || !ready}
      />
      <View style={styles.secondaryRow}>
        <View style={styles.secondaryItem}>
          <CameraActionButton label="Flip Camera" onPress={onFlip} disabled={photoPending} />
        </View>
        {choosePhoto ? <View style={styles.secondaryItem}>{choosePhoto}</View> : null}
      </View>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    justifyContent: "center", alignItems: "center", borderRadius: 12,
    borderWidth: 1, borderColor: marketColor.border, backgroundColor: marketColor.ink,
  },
  primary: { backgroundColor: marketColor.green, borderColor: marketColor.mint },
  pressed: { opacity: 0.82 },
  disabled: { backgroundColor: "#343936", borderColor: "#757C76" },
  label: { color: marketColor.surface, textAlign: "center", fontSize: 16, fontWeight: "700" },
  permission: { alignSelf: "center", width: "100%", maxWidth: 360, gap: spacing.md },
  footer: { paddingHorizontal: 16, paddingVertical: spacing.sm, gap: spacing.sm },
  guide: { color: marketColor.surface, textAlign: "center", fontSize: 14, lineHeight: 20 },
  savedPhotos: { maxHeight: 100 },
  savedContent: { gap: spacing.sm },
  savedLabel: { color: marketColor.surface, fontSize: 14, fontWeight: "600" },
  secondaryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  secondaryItem: { flexGrow: 1, flexBasis: 128 },
});
