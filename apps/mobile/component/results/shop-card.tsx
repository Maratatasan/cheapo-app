import { Pressable, Text, View, StyleSheet } from "react-native";
import { Observation, observationShopLabel, priceLabel } from "@/data/observation";
import { color, ui, spacing, typography } from "./theme";
export type ShopCardProps = Pick<
  Observation,
  "shop" | "area" | "price" | "currency"
> & { number?: number; selected?: boolean; onSelect: () => void };
export function ShopCard({
  shop,
  area,
  price,
  currency,
  number,
  selected = false,
  onSelect,
}: ShopCardProps) {
  const label = observationShopLabel(shop);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Select ${label}`}
      aria-selected={selected}
      onPress={onSelect}
      style={[ui.card, styles.container, selected && styles.selected]}
    >
      <View style={styles.identity}>
        {number !== undefined && (
          <View style={[ui.pill, styles.number]}>
            <Text style={ui.pillText}>{number}</Text>
          </View>
        )}
        <View style={styles.copy}>
          <Text style={styles.name}>{label}</Text>
          <Text style={ui.small}>{area}</Text>
        </View>
      </View>
      <Text style={styles.price}>{priceLabel({ price, currency })}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    flexWrap: "wrap",
  },
  selected: { backgroundColor: color.mint, borderColor: color.green },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
    minWidth: 160,
  },
  number: { backgroundColor: color.white },
  copy: { flex: 1, gap: spacing.xs },
  name: { color: color.ink, fontWeight: "800", fontSize: typography.label },
  price: { fontWeight: "800", color: color.ink },
});
