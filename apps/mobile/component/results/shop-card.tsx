import { Pressable, Text, View, StyleSheet } from "react-native";
import { Observation, dateLabel, observationShopLabel, priceLabel, unitPriceLabel, type PriceValues } from "@/data/observation";
import { EditPriceButton } from "./edit-price-button";
import { PriceDisplay } from "./price-display";
import { color, ui, spacing, typography } from "./theme";
export type ShopCardProps = Pick<
  Observation,
  "shop"
> & Pick<PriceValues, "price" | "currency"> & Partial<Pick<Observation, "area" | "unit_price">> & {
  product?: string;
  capturedOn?: string;
  number?: number;
  selected?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
};
export function ShopCard({
  shop,
  area,
  product,
  capturedOn,
  price,
  currency,
  unit_price = null,
  number,
  selected = false,
  onSelect,
  onEdit,
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
          {product ? <Text style={ui.body}>{product}</Text> : null}
          {capturedOn ? <Text style={ui.small}>Recorded {dateLabel(capturedOn)}</Text> : null}
        </View>
      </View>
      {onEdit && !onSelect ? (
        <View style={styles.prices}>
          <PriceDisplay {...prices} showPackLabel />
          <EditPriceButton label={`Edit ${product ? `${product} at ` : "price at "}${label}${capturedOn ? `, recorded ${dateLabel(capturedOn)}` : ""}`} onPress={onEdit} />
        </View>
      ) : <PriceDisplay {...prices} showPackLabel />}
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
  prices: { gap: spacing.xs, alignItems: "flex-end" },
  number: { backgroundColor: color.white },
  copy: { flex: 1, gap: spacing.xs },
  name: { color: color.ink, fontWeight: "800", fontSize: typography.label },
});
