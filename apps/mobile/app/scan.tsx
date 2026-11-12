import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { shopDisplayName } from "@cheapo/domain/names";
import { CameraComponent } from "@/component/camera";
import { ShopChooser, ShopLoadFeedback } from "@/component/shop/shop-chooser";
import * as localShopActions from "@/data/local-shops";
import { useSavedShops } from "@/hooks/use-saved-shops";

export default function ScanScreen() {
  const router = useRouter();
  const { shops, setShops, readError, retry } = useSavedShops();
  if (!shops) return <ShopLoadFeedback error={readError} onRetry={retry} />;

  const shop = shops.currentShop;
  const displayName = shop && shopDisplayName(shop);
  if (!shop || !displayName) {
    if (readError) return <ShopLoadFeedback error={readError} onRetry={retry} />;
    return (
      <ShopChooser
        state={shops}
        actions={localShopActions}
        onSelected={setShops}
        onCancel={() => router.canGoBack() ? router.back() : router.replace("/")}
      />
    );
  }

  return (
    <View style={styles.container}>
      <CameraComponent currentShop={{ id: shop.id, displayName }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
});
