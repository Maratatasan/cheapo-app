import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Platform } from "react-native";
import { shopDisplayName } from "@cheapo/domain/names";
import { BarcodeScan } from "@/component/barcode-scan";
import { ShopLoadFeedback } from "@/component/shop/shop-chooser";
import { useSavedShops } from "@/hooks/use-saved-shops";
import { canonicalProductBarcode } from "@/data/product-barcode";

export default function FindProductScreen() {
  const router = useRouter();
  const { barcode, productId } = useLocalSearchParams<{ barcode?: string; productId?: string }>();
  const initialBarcode = typeof barcode === "string" ? canonicalProductBarcode(barcode) ?? undefined : undefined;
  const initialProductId = typeof productId === "string" ? productId : undefined;
  const { shops, readError, retry } = useSavedShops();
  const shop = shops?.currentShop;
  const displayName = shop && shopDisplayName(shop);

  if (Platform.OS === "web") return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: initialProductId ? "Compare saved prices" : "Find product by barcode" }} />
      {shops || readError ? (
        <BarcodeScan key={initialProductId ?? initialBarcode} currentShop={shop && displayName ? { id: shop.id, displayName } : undefined}
          initialBarcode={initialBarcode} initialProductId={initialProductId}
          onScanLabel={() => router.replace("/scan")} />
      ) : <ShopLoadFeedback onRetry={retry} />}
    </>
  );
}
