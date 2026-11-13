import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import { ShopRepositoryProvider } from "@/component/shop/shop-repository-provider";
import * as localShopRepository from "@/data/local-shops";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ShopRepositoryProvider repository={localShopRepository}>
        <Stack />
      </ShopRepositoryProvider>
    </SafeAreaProvider>
  );
}
