import { Redirect, Stack } from "expo-router";

import { CheapoConnection } from "@/component/cheapo-connection";
import { cheapoAccess } from "@/lib/cheapo-access/device";

export default function CheapoAccessScreen() {
  if (!cheapoAccess) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: "Device settings" }} />
      <CheapoConnection access={cheapoAccess} />
    </>
  );
}
