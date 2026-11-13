import { View, StyleSheet, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { shopDisplayName } from "@cheapo/domain/names";
import { CameraComponent } from "@/component/camera";
import { BarcodeScan } from "@/component/barcode-scan";
import { ShopChooser, ShopLoadFeedback } from "@/component/shop/shop-chooser";
import { useSavedShops } from "@/hooks/use-saved-shops";

export default function ScanScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { shopRepository, shops, setShops, readError, retry } = useSavedShops();
  if (!shops) return <ShopLoadFeedback error={readError} onRetry={retry} />;

  const shop = shops.currentShop;
  const displayName = shop && shopDisplayName(shop);
  if (!shop || !displayName) {
    if (readError) return <ShopLoadFeedback error={readError} onRetry={retry} />;
    return (
      <ShopChooser
        state={shops}
        actions={shopRepository}
        onSelected={setShops}
        onCancel={() => router.canGoBack() ? router.back() : router.replace("/")}
      />
    );
  }

  return (
    <View style={styles.container}>
      {mode === "barcode" && Platform.OS !== "web" ? (
        <BarcodeScan key={shop.id} currentShop={{ id: shop.id, displayName }}
          onScanLabel={() => router.setParams({ mode: "label" })} />
      ) : (
        <CameraComponent currentShop={{ id: shop.id, displayName }}
          onScanBarcode={Platform.OS === "web" ? undefined : () => router.setParams({ mode: "barcode" })} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
});
