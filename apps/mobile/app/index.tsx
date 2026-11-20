import { useState } from "react";
import { Button, Platform, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import Constants from "expo-constants";
import { useCheapoShopping } from "@/component/cheapo-shopping-provider";
import { ShopChooser, ShopLoadFeedback, ShopSyncFeedback } from "@/component/shop/shop-chooser";
import { ShopHome } from "@/component/shop/shop-home";
import { useSavedShops } from "@/hooks/use-saved-shops";
import { fieldCheapoApiOrigin } from "@/lib/cheapo-access/config";
import { ui } from "@/component/results/theme";

export default function Index() {
  const router = useRouter();
  const shopping = useCheapoShopping();
  const [choosing, setChoosing] = useState(false);
  const { shopRepository, shops, setShops, readError, retry } = useSavedShops();
  const showDeveloperTools = Constants.expoConfig?.extra?.directAuthTest === true;
  const showCheapoAccess = fieldCheapoApiOrigin() !== null;
  const fieldTest = Platform.OS === "android" && Constants.expoConfig?.extra?.fieldTest === true;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Cheapo",
          headerTransparent: { ios: false },
          headerRight: showDeveloperTools
            ? () => <Button title="Developer tools" onPress={() => router.push("/developer-tools")} />
            : fieldTest ? () => (
                <View style={ui.row}>
                  <Button title="ChatGPT" onPress={() => router.push("/direct-auth")} />
                  {showCheapoAccess ? <Button title="Cheapo access" onPress={() => router.push("/cheapo-access")} /> : null}
                </View>
              )
            : undefined,
        }}
      />
      {choosing && shops ? (
        <ShopChooser
          state={shops}
          actions={shopRepository}
          management={{
            updateShop: (...args) => shopRepository.updateShop(...args),
            removeShop: (...args) => shopRepository.removeShop(...args),
            onChanged: setShops,
          }}
          onSelected={(state) => { setShops(state); setChoosing(false); }}
          onCancel={() => setChoosing(false)}
        />
      ) : (
        <>
          {(!shops || readError) ? <ShopLoadFeedback error={readError} onRetry={retry} /> : null}
          <ShopSyncFeedback sync={shops?.sync} />
          <ShopHome
            currentShop={shops?.currentShop}
            onChooseShop={shops && !readError ? () => setChoosing(true) : undefined}
            onScan={() => router.push(Platform.OS === "web" ? "/scan" : { pathname: "/scan", params: { mode: "lookup" } })}
            onFindBarcode={Platform.OS === "web" ? undefined : () => router.push("/find-product")}
            onAddProduct={shopping || showCheapoAccess ? () => router.push("/add-product") : undefined}
            onOpenSaved={() => router.push("/saved-products")}
            onOpenPending={shopping ? () => router.push("/pending-sync") : undefined}
            onExploreSamples={() => router.push("/results")}
            onOpenStorage={Platform.OS === "web" ? undefined : () => router.push("/storage-cache")}
          />
        </>
      )}
    </>
  );
}
