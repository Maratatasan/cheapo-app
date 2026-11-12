import { observationShopLabel } from "@/data/observation";
import MapView, { Marker } from "react-native-maps";
import { View, Text } from "react-native";
import { ShopMapProps } from "./shop-map.types";
import { color, ui } from "./theme";
export function ShopMap({ observations, selectedId, onSelect }: ShopMapProps) {
  if (!observations.length)
    return (
      <View style={ui.card}>
        <Text style={ui.body}>No sample shop positions to show.</Text>
      </View>
    );
  return (
    <MapView
      style={{ height: 310, borderRadius: 22 }}
      initialRegion={{
        latitude: 51.419,
        longitude: -0.185,
        latitudeDelta: 0.035,
        longitudeDelta: 0.045,
      }}
      showsUserLocation={false}
      showsMyLocationButton={false}
      toolbarEnabled={false}
    >
      {observations.map((item, index) => (
        <Marker
          key={item.id}
          identifier={item.id}
          coordinate={item.coordinate}
          title={`${index + 1}. ${observationShopLabel(item.shop)} · illustrative pin`}
          description="Not a verified branch location"
          pinColor={item.id === selectedId ? color.green : "#A17234"}
          onPress={() => onSelect(item.id)}
        />
      ))}
    </MapView>
  );
}
