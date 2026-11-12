import { Text, View, StyleSheet } from "react-native";
import { PriceValues, priceLabel, unitPriceLabel } from "@/data/observation";
import { color, ui, spacing, typography } from "./theme";
/** Pack price and supplied unit price stay independent; unknown values are explicit. */
export function PriceDisplay({ showPackLabel = false, ...values }: PriceValues & { showPackLabel?: boolean }) {
  return (
    <View style={styles.container}>
      {showPackLabel ? <Text style={ui.small}>Pack price</Text> : null}
      <Text style={styles.price}>{priceLabel(values)}</Text>
      <Text style={showPackLabel ? ui.body : ui.small}>{unitPriceLabel(values)}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { alignItems: "flex-end", gap: spacing.xs, flexShrink: 1 },
  price: { fontSize: typography.price, fontWeight: "800", color: color.ink },
});
