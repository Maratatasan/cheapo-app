import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { marketColor, spacing, ui } from "../results/theme";

export function ShopRemovalConfirmation({ name, isCurrent, busy, error, onConfirm, onCancel }: {
  name: string;
  isCurrent: boolean;
  busy: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ScrollView style={ui.page} contentContainerStyle={ui.content}>
      <Text accessibilityRole="header" style={ui.title}>Remove {name}?</Text>
      <Text style={ui.body}>
        This shop will be removed from your saved shops. Previous prices and photos will be kept.
      </Text>
      {isCurrent ? <Text style={ui.body}>You’ll need to select a shop before your next scan.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy}
        onPress={onConfirm} style={[ui.button, styles.remove, busy && styles.busy]}>
        <Text style={ui.buttonText}>{busy ? "Removing shop…" : "Remove shop"}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.cancel}>
        <Text style={styles.cancelLabel}>Cancel</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  remove: { backgroundColor: "#9B2C2C" },
  busy: { opacity: 0.65 },
  error: { color: "#9B2C2C", fontSize: 14 },
  cancel: { minHeight: 46, justifyContent: "center", alignItems: "center", paddingHorizontal: spacing.md },
  cancelLabel: { color: marketColor.green, fontWeight: "700" },
});
