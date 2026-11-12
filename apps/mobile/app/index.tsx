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
  const { shops, setShops, readError, retry } = useSavedShops();
  const showDeveloperTools = Constants.expoConfig?.extra?.directAuthTest === true;
  const fieldTest = Platform.OS === "android" && Constants.expoConfig?.extra?.fieldTest === true;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Cheapo",
          headerRight: showDeveloperTools
            ? () => <Button title="Developer tools" onPress={() => router.push("/developer-tools")} />
            : fieldTest ? () => <Button title="ChatGPT" onPress={() => router.push("/direct-auth")} />
            : undefined,
        }}
      />
      {choosing && shops ? (
        <ShopChooser
          state={shops}
          actions={localShopActions}
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
