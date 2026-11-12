import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Shop } from "@cheapo/domain";
import { shopDisplayName } from "@cheapo/domain/names";
import { color, typography, ui } from "@/component/results/theme";

type ShopHomeProps = {
  currentShop?: Shop;
  onChooseShop?: () => void;
  onScan: () => void;
  onOpenSaved?: () => void;
  onExploreSamples?: () => void;
};

export function ShopHome({ currentShop, onChooseShop, onScan, onOpenSaved, onExploreSamples }: ShopHomeProps) {
  const shopLabel = currentShop ? shopDisplayName(currentShop) : undefined;

  return (
    <ScrollView style={ui.page} contentContainerStyle={ui.content}>
      {shopLabel || onChooseShop ? (
        <View style={ui.card}>
          {shopLabel ? <Text style={styles.currentShop}>{`You're at: ${shopLabel}`}</Text> : null}
          {onChooseShop ? (
            <Pressable accessibilityRole="button" onPress={onChooseShop} style={[ui.button, styles.secondary]}>
              <Text style={styles.action}>{shopLabel ? "Change shop" : "Select current shop"}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onScan} style={[ui.button, styles.scan]}>
        <Text style={[ui.buttonText, styles.scanLabel]}>Scan item</Text>
      </Pressable>
      {onOpenSaved ? (
        <Pressable accessibilityRole="button" onPress={onOpenSaved} style={[ui.button, styles.secondary]}>
          <Text style={styles.action}>Saved products and photos</Text>
        </Pressable>
      ) : null}
      {onExploreSamples ? (
        <Pressable accessibilityRole="button" onPress={onExploreSamples} style={[ui.button, styles.samples]}>
          <Text style={styles.action}>Explore sample prices</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  currentShop: { color: color.ink, fontSize: typography.section, fontWeight: "700" },
  action: { color: color.green, fontSize: typography.body, fontWeight: "700" },
  secondary: { backgroundColor: color.mint, alignSelf: "flex-start" },
  scan: { minHeight: 56, justifyContent: "center" },
  scanLabel: { fontSize: typography.label },
  samples: { backgroundColor: "transparent", alignSelf: "center" },
});
