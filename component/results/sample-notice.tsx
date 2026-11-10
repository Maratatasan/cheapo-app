import { Text, View } from "react-native";
import { color, ui } from "./theme";
export function SampleNotice({ map = false }: { map?: boolean }) {
  return (
    <View
      style={{
        backgroundColor: color.amber,
        padding: 14,
        borderRadius: 16,
        gap: 5,
      }}
    >
      <Text style={{ color: "#795516", fontWeight: "800", fontSize: 12 }}>
        SAMPLE DATA · FOR EXPLORING ONLY
      </Text>
      <Text style={[ui.small, { color: "#795516" }]}>
        {map
          ? "Pins are illustrative positions, not verified shop locations. Distances are made up. Do not use this map for travel."
          : "Prices, shops and dates are examples. These are not live prices or stock checks. Always check the shelf and offer terms."}
      </Text>
    </View>
  );
}
