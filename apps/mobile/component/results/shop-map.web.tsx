import { observationShopLabel } from "@/data/observation";
import { useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";
import { ShopMapProps } from "./shop-map.types";
import { color, ui } from "./theme";
// Standard Web Mercator coordinates, matching OSM raster tiles at zoom 13.
const zoom = 13;
function point(latitude: number, longitude: number) {
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * 2 ** zoom * 256,
    y:
      (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 2 ** zoom * 256,
  };
}
const center = point(51.419, -0.185);
export function ShopMap({ observations, selectedId, onSelect }: ShopMapProps) {
  const [width, setWidth] = useState(350);
  const [failed, setFailed] = useState(false);
  const left = center.x - width / 2,
    top = center.y - 155;
  const tiles = [];
  for (
    let x = Math.floor(left / 256);
    x <= Math.floor((left + width) / 256);
    x++
  )
    for (let y = Math.floor(top / 256); y <= Math.floor((top + 310) / 256); y++)
      tiles.push({ x, y });
  return (
    <View style={{ gap: 8 }}>
      <View
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={{
          height: 310,
          backgroundColor: "#E2E9DE",
          borderRadius: 22,
          overflow: "hidden",
        }}
      >
        {tiles.map((tile) => (
          <Image
            key={`${tile.x}/${tile.y}`}
            accessibilityIgnoresInvertColors
            source={{
              uri: `https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`,
            }}
            onError={() => setFailed(true)}
            style={{
              position: "absolute",
              left: tile.x * 256 - left,
              top: tile.y * 256 - top,
              width: 256,
              height: 256,
            }}
          />
        ))}
        {observations.map((item, index) => {
          const p = point(item.coordinate.latitude, item.coordinate.longitude);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`Map pin: ${observationShopLabel(item.shop)}`}
              accessibilityState={{ selected: item.id === selectedId }}
              onPress={() => onSelect(item.id)}
              style={{
                position: "absolute",
                left: p.x - left - 20,
                top: p.y - top - 20,
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: selectedId === item.id ? color.green : "#FFF",
                borderWidth: 3,
                borderColor: "#FFF",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 7px #0003",
              }}
            >
              <Text
                style={{
                  color: selectedId === item.id ? "#FFF" : color.ink,
                  fontWeight: "800",
                }}
              >
                {index + 1}
              </Text>
            </Pressable>
          );
        })}
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 12,
            top: 12,
            padding: 8,
            borderRadius: 12,
            backgroundColor: "#FFF",
          }}
        >
          <Text style={ui.pillText}>Illustrative pins</Text>
        </View>
        <Pressable
          accessibilityRole="link"
          onPress={() =>
            Linking.openURL("https://www.openstreetmap.org/copyright")
          }
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            backgroundColor: "#FFFFFFEE",
            padding: 5,
          }}
        >
          <Text style={{ fontSize: 10, color: color.ink }}>
            © OpenStreetMap contributors
          </Text>
        </Pressable>
      </View>
      {failed && (
        <Text accessibilityRole="alert" style={ui.small}>
          Street map could not load. The shop list below is still available; pin
          positions remain illustrative.
        </Text>
      )}
      <Text style={ui.small}>
        Street map preview · select a numbered pin or a shop below.
      </Text>
    </View>
  );
}
