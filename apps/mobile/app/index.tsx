import { useState } from "react";
import { Button, Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import Constants from "expo-constants";
import { ShopChooser, ShopLoadFeedback } from "@/component/shop/shop-chooser";
import { ShopHome } from "@/component/shop/shop-home";
import * as localShopActions from "@/data/local-shops";
import { useSavedShops } from "@/hooks/use-saved-shops";

export default function Index() {
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [fixtureError, setFixtureError] = useState(false);
  const { shops, setShops, readError, retry } = useSavedShops();
  const showDeveloperTools = Constants.expoConfig?.extra?.directAuthTest === true;
  const fieldTest = Platform.OS === "android" && Constants.expoConfig?.extra?.fieldTest === true;
  const shoppingFixture = Platform.OS === "ios"
    && Constants.expoConfig?.ios?.bundleIdentifier === "com.maratatasan.cheapo.shopping-test"
    && Constants.expoConfig?.extra?.iosShoppingFixture === true;

  async function loadFixtures() {
    setSeeding(true);
    setFixtureError(false);
    try {
      const { seedIosShoppingFixtures } = await import("@/data/ios-shopping-fixtures");
      await seedIosShoppingFixtures();
      setShops(await localShopActions.loadSavedShops());
      router.push("/saved-products");
    } catch {
      setFixtureError(true);
    } finally {
      setSeeding(false);
    }
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Cheapo",
          headerTransparent: { ios: false },
          headerRight: showDeveloperTools
            ? () => <Button title="Developer tools" onPress={() => router.push("/developer-tools")} />
            : fieldTest ? () => <Button title="ChatGPT" onPress={() => router.push("/direct-auth")} />
            : shoppingFixture
              ? () => <Button title={fixtureError ? "Retry fixtures" : "Load fixtures"} disabled={seeding} onPress={() => void loadFixtures()} />
              : undefined,
        }}
      />
      {choosing && shops ? (
        <ShopChooser
          state={shops}
          actions={localShopActions}
          management={{
            updateShop: localShopActions.updateShop,
            removeShop: localShopActions.removeShop,
            onChanged: setShops,
          }}
          onSelected={(state) => { setShops(state); setChoosing(false); }}
          onCancel={() => setChoosing(false)}
        />
      ) : (
        <>
          {(!shops || readError) ? <ShopLoadFeedback error={readError} onRetry={retry} /> : null}
          <ShopHome
            currentShop={shops?.currentShop}
            onChooseShop={shops && !readError ? () => setChoosing(true) : undefined}
            onScan={() => router.push("/scan")}
            onOpenSaved={() => router.push("/saved-products")}
            onExploreSamples={() => router.push("/results")}
          />
        </>
      )}
    </>
  );
}
