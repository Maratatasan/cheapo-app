import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { color, ui, spacing, typography } from "./theme";
export type DisplayStateProps = {
  kind: "loading" | "error" | "empty";
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};
export function DisplayState({
  kind,
  title,
  description,
  actionLabel,
  onAction,
}: DisplayStateProps) {
  return (
    <View
      accessibilityRole={kind === "error" ? "alert" : undefined}
      style={[ui.card, { gap: spacing.md }]}
    >
      {kind === "loading" && (
        <ActivityIndicator
          accessibilityLabel="Loading observations"
          color={color.green}
        />
      )}
      <Text
        style={{
          fontWeight: "700",
          color: color.ink,
          fontSize: typography.section,
        }}
      >
        {title}
      </Text>
      <Text style={ui.body}>{description}</Text>
      {actionLabel && onAction && (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={ui.button}
        >
          <Text style={ui.buttonText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
