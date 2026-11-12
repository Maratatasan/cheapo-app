import { Button } from "react-native";
import { Stack, useRouter } from "expo-router";
import Constants from "expo-constants";
import { ShopHome } from "@/component/shop/shop-home";

export default function Index() {
  const router = useRouter();
  const showDeveloperTools = Constants.expoConfig?.extra?.directAuthTest === true;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Cheapo",
          headerRight: showDeveloperTools
            ? () => <Button title="Developer tools" onPress={() => router.push("/developer-tools")} />
            : undefined,
        }}
      />
      <ShopHome
        onScan={() => router.push("/scan")}
        onExploreSamples={() => router.push("/results")}
      />
    </>
  );
}
