import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Observation } from "@/data/observation";
import { DisplayState } from "./display-state";
import { ObservationCard } from "./observation-card";
import { color, ui } from "./theme";
export function ResultsBrowser({
  observations,
  onShop,
  state = "ready",
  onRetry,
}: {
  observations: Observation[];
  state?: "ready" | "loading" | "error";
  onRetry?: () => void;
  onShop?: (id: string) => void;
}) {
  const [sort, setSort] = useState<"price" | "distance">("price");
  const [query, setQuery] = useState("");
  const rows = observations
    .filter((item) =>
      `${item.product} ${item.shop} ${item.brand}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        (sort === "price"
          ? (a.price ?? Infinity) - (b.price ?? Infinity)
          : (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)) ||
        a.id.localeCompare(b.id),
    );
  if (state === "loading")
    return (
      <DisplayState
        kind="loading"
        title="Loading observations"
        description="Your price notebook will appear here."
      />
    );
  if (state === "error")
    return (
      <DisplayState
        kind="error"
        title="Couldn’t load observations"
        description="Please try again when you’re ready."
        actionLabel="Try again"
        onAction={onRetry}
      />
    );
  return (
    <View style={{ gap: 15 }}>
      <TextInput
        accessibilityLabel="Search sample observations"
        placeholder="Search a product or shop"
        value={query}
        onChangeText={setQuery}
        style={{
          backgroundColor: "#FFF",
          borderWidth: 1,
          borderColor: color.line,
          borderRadius: 16,
          padding: 16,
          fontSize: 15,
          color: color.ink,
        }}
      />
      <View style={ui.between}>
        <Text style={ui.small}>{rows.length} sample observations</Text>
        <View style={ui.row}>
          {(["price", "distance"] as const).map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              aria-selected={sort === mode}
              onPress={() => setSort(mode)}
              style={[
                ui.pill,
                {
                  minHeight: 44,
                  justifyContent: "center",
                  backgroundColor: sort === mode ? color.green : "#EAEDE5",
                },
              ]}
            >
              <Text style={[ui.pillText, sort === mode && { color: "#FFF" }]}>
                {mode === "price" ? "Cheapest" : "Nearest"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Text style={ui.small}>
        {sort === "price"
          ? "Pack price, low to high. Offer conditions may differ."
          : "Illustrative distances only. Your location is not used."}
      </Text>
      {rows.map((item) => (
        <ObservationCard
          key={item.id}
          item={item}
          onShop={onShop ? () => onShop(item.id) : undefined}
        />
      ))}
      {rows.length === 0 && (
        <DisplayState
          kind="empty"
          title="No observations yet"
          description="Try another search. A price photo can become a dated observation after you review it and confirm the shop."
        />
      )}
    </View>
  );
}
