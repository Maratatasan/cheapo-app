import { Pressable, Text, View, StyleSheet } from "react-native";
import { Observation, dateLabel, priceLabel } from "@/data/observation";
import { PriceDisplay } from "./price-display";
import { OfferNotice } from "./offer-notice";
import { color, ui } from "./theme";
export function ObservationCard({
  item,
  onShop,
}: {
  item: Observation;
  onShop?: () => void;
}) {
  return (
    <View
      style={ui.card}
      accessibilityLabel={`Observation: ${item.shop}, ${priceLabel(item)}`}
    >
      <View style={ui.between}>
        <Text style={ui.eyebrow}>{item.shop.toUpperCase()}</Text>
        <Text
          style={[
            ui.pillText,
            { flexShrink: 1 },
            item.note ? { color: color.warningInk } : {},
          ]}
        >
          {item.status}
        </Text>
      </View>
      <View style={[ui.between, { flexWrap: "wrap" }]}>
        <View style={{ flex: 1, minWidth: 145, gap: 5 }}>
          <Text style={styles.name}>{item.product}</Text>
          <Text style={ui.small}>
            {item.brand} · {item.pack}
          </Text>
        </View>
        <PriceDisplay
          price={item.price}
          currency={item.currency}
          unit_price={item.unit_price}
        />
      </View>
      <Text style={ui.body}>{item.area}</Text>
      <Text style={ui.small}>
        Observed {dateLabel(item.observedOn)} ·{" "}
        {item.distanceKm === null
          ? "Distance unknown"
          : `${item.distanceKm.toFixed(1)} km sample distance`}
      </Text>
      <OfferNotice condition={item.condition} uncertainty={item.note} />
      {onShop && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See ${item.shop} on map`}
          onPress={onShop}
          style={styles.link}
        >
          <Text style={{ color: color.green, fontWeight: "700" }}>
            See shop on map ↗
          </Text>
        </Pressable>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  name: { fontSize: 18, fontWeight: "700", color: color.ink },
  link: { minHeight: 36, justifyContent: "center", alignSelf: "flex-start" },
});
