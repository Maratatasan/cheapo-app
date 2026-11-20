import { Redirect, Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheapoConnection } from "@/component/cheapo-connection";
import { cheapoAccess } from "@/lib/cheapo-access/device";

export default function CheapoAccessScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (!cheapoAccess) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: "Device settings" }} />
      <CheapoConnection
        access={cheapoAccess}
        onBack={() => router.dismissTo("/")}
        bottomInset={insets.bottom}
      />
    </>
  );
}
