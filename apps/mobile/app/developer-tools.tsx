import { Button, ScrollView } from "react-native";
import { Redirect, Stack, useRouter } from "expo-router";
import Constants from "expo-constants";
import { ui } from "@/component/results/theme";

export default function DeveloperTools() {
  const router = useRouter();

  if (Constants.expoConfig?.extra?.directAuthTest !== true) {
    return <Redirect href="/" />;
  }

  return (
    <ScrollView style={ui.page} contentContainerStyle={ui.content}>
      <Stack.Screen options={{ title: "Developer tools" }} />
      <Button title="Direct phone sign-in test" onPress={() => router.push("/direct-auth")} />
    </ScrollView>
  );
}
