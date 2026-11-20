import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Platform } from "react-native";
import { shopDisplayName } from "@cheapo/domain/names";
import { BarcodeScan } from "@/component/barcode-scan";
import { ShopLoadFeedback } from "@/component/shop/shop-chooser";
import { useSavedShops } from "@/hooks/use-saved-shops";
import { canonicalProductBarcode } from "@/data/product-barcode";

export default function FindProductScreen() {
  const router = useRouter();
  const { barcode } = useLocalSearchParams<{ barcode?: string }>();
  const initialBarcode = typeof barcode === "string" ? canonicalProductBarcode(barcode) ?? undefined : undefined;
  const { shops, readError, retry } = useSavedShops();
  const shop = shops?.currentShop;
  const displayName = shop && shopDisplayName(shop);

  if (Platform.OS === "web") return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: "Find product by barcode" }} />
      {shops || readError ? (
        <BarcodeScan currentShop={shop && displayName ? { id: shop.id, displayName } : undefined} initialBarcode={initialBarcode}
          onScanLabel={() => router.replace("/scan")} />
      ) : <ShopLoadFeedback onRetry={retry} />}
    </>
  );
}
