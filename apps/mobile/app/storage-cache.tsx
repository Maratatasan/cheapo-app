import { useCallback } from "react";
import { Redirect, Stack, useRouter } from "expo-router";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useCheapoShopping } from "@/component/cheapo-shopping-provider";
import { clearLegacyShopping } from "@/data/legacy-shopping-cleanup";
import { StorageCache } from "@/component/storage-cache";
import { cheapoShoppingReadCache } from "@/data/cheapo-shopping-read-cache";

export default function StorageCacheScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const shopping = useCheapoShopping();
  const legacyCleanup = useCallback(() => {
    if (!shopping) throw Error("Cheapo access is required.");
    return clearLegacyShopping(shopping);
  }, [shopping]);
  if (Platform.OS === "web") return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: "Storage & cache" }} />
      <StorageCache cache={cheapoShoppingReadCache} onBack={() => router.dismissTo("/")} bottomInset={insets.bottom}
        legacyCleanup={shopping ? legacyCleanup : undefined} />
    </>
  );
}
