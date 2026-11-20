import { Redirect, Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Platform } from "react-native";
import { useEffect, useState } from "react";
import { shopDisplayName } from "@cheapo/domain/names";
import { BarcodeScan } from "@/component/barcode-scan";
import { ShopChooser, ShopLoadFeedback } from "@/component/shop/shop-chooser";
import { useCheapoShopping } from "@/component/cheapo-shopping-provider";
import { useSavedShops } from "@/hooks/use-saved-shops";
import { canonicalProductBarcode } from "@/data/product-barcode";
import { productPhotoPriceSources } from "@/data/photo-price-source";
import { photoShopCountry } from "@/lib/direct-auth/shop-country";

export default function FindProductScreen() {
  const router = useRouter();
  const { barcode, productId, photoSource } = useLocalSearchParams<{ barcode?: string; productId?: string; photoSource?: string }>();
  const initialBarcode = typeof barcode === "string" ? canonicalProductBarcode(barcode) ?? undefined : undefined;
  const initialProductId = typeof productId === "string" ? productId : undefined;
  const shopping = useCheapoShopping();
  const { shopRepository, shops, setShops, readError, retry } = useSavedShops();
  const [choosingShop, setChoosingShop] = useState(false);
  const intent = typeof photoSource === "string" ? productPhotoPriceSources.get(photoSource) : undefined;
  const source = intent?.owner === shopping ? intent : undefined;
  useEffect(() => {
    if (typeof photoSource !== "string" || !source) return;
    return () => { if (productPhotoPriceSources.get(photoSource) === source) productPhotoPriceSources.delete(photoSource); };
  }, [photoSource, source]);
  const shop = shops?.currentShop;
  const displayName = shop && shopDisplayName(shop);

  if (Platform.OS === "web") return <Redirect href="/" />;
  if (choosingShop && shops) return <ShopChooser state={shops} actions={shopRepository}
    onSelected={state => { setShops(state); setChoosingShop(false); }} onCancel={() => setChoosingShop(false)} />;

  return (
    <>
      <Stack.Screen options={{ title: initialProductId ? "Compare saved prices" : "Find product by barcode" }} />
      {shops || readError ? (
        <BarcodeScan key={source ? photoSource : initialProductId ?? initialBarcode} currentShop={shop && displayName ? { id: shop.id, displayName } : undefined}
          currentShopCountry={photoShopCountry(shop?.address)} initialBarcode={initialBarcode} initialProductId={initialProductId}
          photoSource={source} onChooseShop={source && shops ? () => setChoosingShop(true) : undefined}
          onScanLabel={() => router.replace("/scan")} />
      ) : <ShopLoadFeedback onRetry={retry} />}
    </>
  );
}
