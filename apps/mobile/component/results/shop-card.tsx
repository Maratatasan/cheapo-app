import { Pressable, Text, View, StyleSheet } from "react-native";
import { Observation, observationShopLabel, priceLabel, unitPriceLabel } from "@/data/observation";
import { PriceDisplay } from "./price-display";
import { color, ui, spacing, typography } from "./theme";
export type ShopCardProps = Pick<
  Observation,
  "shop" | "price" | "currency"
> & Partial<Pick<Observation, "area" | "unit_price">> & {
  number?: number;
  selected?: boolean;
  onSelect?: () => void;
};
export function ShopCard({
  shop,
  area,
  price,
  currency,
  unit_price = null,
  number,
  selected = false,
  onSelect,
}: ShopCardProps) {
  const label = observationShopLabel(shop);
  const prices = { price, currency, unit_price };
  const cardStyle = [ui.card, styles.container, selected && styles.selected];
  const content = (
    <>
      <View style={styles.identity}>
        {number !== undefined && (
          <View style={[ui.pill, styles.number]}>
            <Text style={ui.pillText}>{number}</Text>
          </View>
        )}
        <View style={styles.copy}>
          <Text style={styles.name}>{label}</Text>
          {area ? <Text style={ui.small}>{area}</Text> : null}
        </View>
      </View>
      <PriceDisplay {...prices} showPackLabel />
    </>
  );

  if (!onSelect) return <View style={cardStyle}>{content}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Select ${label}`}
      accessibilityHint={`Pack price ${priceLabel(prices)}. ${unitPriceLabel(prices)}`}
      aria-selected={selected}
      onPress={onSelect}
      style={cardStyle}
    >
      {content}
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
});
