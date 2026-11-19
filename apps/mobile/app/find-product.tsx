import { Redirect, Stack, useRouter } from "expo-router";
import { Platform } from "react-native";
import { shopDisplayName } from "@cheapo/domain/names";
import { BarcodeScan } from "@/component/barcode-scan";
import { ShopLoadFeedback } from "@/component/shop/shop-chooser";
import { useSavedShops } from "@/hooks/use-saved-shops";

export default function FindProductScreen() {
  const router = useRouter();
  const { shops, readError, retry } = useSavedShops();
  const shop = shops?.currentShop;
  const displayName = shop && shopDisplayName(shop);

  if (Platform.OS === "web") return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: "Find product by barcode" }} />
      {shops || readError ? (
        <BarcodeScan currentShop={shop && displayName ? { id: shop.id, displayName } : undefined}
          onScanLabel={() => router.replace("/scan")} />
      ) : <ShopLoadFeedback onRetry={retry} />}
    </>
  );
}
