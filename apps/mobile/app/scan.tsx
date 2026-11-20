import { View, StyleSheet, Platform } from "react-native";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { shopDisplayName } from "@cheapo/domain/names";
import { CameraComponent } from "@/component/camera";
import { BarcodeScan } from "@/component/barcode-scan";
import { useCheapoShopping } from "@/component/cheapo-shopping-provider";
import type { ProductCandidateLookupProps } from "@/component/product-candidate-lookup";
import { ShopChooser, ShopLoadFeedback } from "@/component/shop/shop-chooser";
import { createOwnerShoppingReads } from "@/data/cheapo-shopping-read-device";
import { productPhotoPriceSources } from "@/data/photo-price-source";
import { useSavedShops } from "@/hooks/use-saved-shops";
import { photoShopCountry } from "@/lib/direct-auth/shop-country";

export default function ScanScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  if (mode === "lookup" && Platform.OS !== "web") return <ProductLookupScreen />;
  return <PriceScanScreen mode={mode} />;
}

function ProductLookupScreen() {
  const router = useRouter();
  const shopping = useCheapoShopping();
  const activePhotoSource = useRef<string>(undefined);
  const clearPhotoSource = useCallback(() => {
    if (activePhotoSource.current) productPhotoPriceSources.delete(activePhotoSource.current);
    activePhotoSource.current = undefined;
  }, []);
  useEffect(() => clearPhotoSource, [clearPhotoSource, shopping]);
  const candidateLookup = useMemo<ProductCandidateLookupProps | undefined>(() => {
    if (!shopping) return;
    const reads = createOwnerShoppingReads(shopping.owner);
    return {
      async findCandidates(identity, signal) {
        const result = await reads.searchProductCandidates(identity, signal);
        if (result.status !== "fresh") throw Error("Catalog lookup unavailable.");
        return result.value;
      },
      onCompare(candidate) {
        if (candidate.kind === "catalog") {
          router.push({ pathname: "/find-product", params: { productId: candidate.product.id } });
        } else {
          router.push({ pathname: "/compare/[id]", params: { id: candidate.observationId, source: "shared" } });
        }
      },
    };
  }, [router, shopping]);
  return <>
    <Stack.Screen options={{ title: "Find product from a photo" }} />
    <CameraComponent productLookup={{ onCompare: (barcode, product, draft) => {
      clearPhotoSource();
      activePhotoSource.current = draft.id;
      const { original, selected, cropBox, capturedAt } = draft;
      productPhotoPriceSources.set(draft.id, { productId: product.id, owner: shopping, source: { original, selected, cropBox, capturedAt } });
      router.push({ pathname: "/find-product", params: { barcode, photoSource: draft.id } });
    },
      onRetake: clearPhotoSource, candidateLookup }} />
  </>;
}

function PriceScanScreen({ mode }: { mode?: string }) {
  const router = useRouter();
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
          currentShopCountry={photoShopCountry(shop.address)}
          onCompareBarcode={Platform.OS === "web" ? undefined : barcode => router.push({ pathname: "/find-product", params: { barcode } })}
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
