import { Text, View, StyleSheet } from "react-native";
import { color, ui, spacing } from "./theme";
export type OfferNoticeProps = {
  condition: string | null;
  uncertainty?: string | null;
};
export function OfferNotice({ condition, uncertainty }: OfferNoticeProps) {
  return (
    <View style={styles.container}>
      <Text style={ui.small}>
        {condition || "Offer conditions not recorded"}
      </Text>
      {uncertainty && (
        <Text style={[ui.small, styles.uncertainty]}>{uncertainty}</Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderColor: color.line,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
  uncertainty: { color: color.warningInk },
});
