import { useState } from "react";
import { Text, View } from "react-native";
import { Observation } from "@/data/observation";
import { ObservationCard } from "./observation-card";
import { ShopCard } from "./shop-card";
import { DisplayState } from "./display-state";
import { ShopMap } from "./shop-map";
import { color, ui } from "./theme";
export function ShopsBrowser({
  observations,
  initialId,
}: {
  observations: Observation[];
  initialId?: string;
}) {
  const [selectedId, setSelectedId] = useState(
    initialId ?? observations[0]?.id ?? null,
  );
  const selected =
    observations.find((item) => item.id === selectedId) ?? observations[0];
  return (
    <View style={{ gap: 16 }}>
      <ShopMap
        observations={observations}
        selectedId={selected?.id ?? null}
        onSelect={setSelectedId}
      />
      {selected && (
        <View style={{ gap: 9 }}>
          <Text style={ui.eyebrow}>SELECTED SHOP · ILLUSTRATIVE POSITION</Text>
          <ObservationCard item={selected} />
        </View>
      )}
      <Text style={{ fontSize: 20, fontWeight: "800", color: color.ink }}>
        Explore the shops
      </Text>
      {observations.map((item, index) => (
        <ShopCard
          key={item.id}
          shop={item.shop}
          area={item.area}
          price={item.price}
          currency={item.currency}
          unit_price={item.unit_price}
          number={index + 1}
          selected={selected?.id === item.id}
          onSelect={() => setSelectedId(item.id)}
        />
      ))}
      {!observations.length && (
        <DisplayState
          kind="empty"
          title="No shops to show yet"
          description="Reviewed observations will help build your shop list."
        />
      )}
    </View>
  );
}
