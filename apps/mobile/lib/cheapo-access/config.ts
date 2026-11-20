import Constants from "expo-constants";
import { Platform } from "react-native";

import { parseCheapoApiOrigin } from "./origin";

export function fieldCheapoApiOrigin() {
  const extra = Constants.expoConfig?.extra;
  if (Platform.OS === "android" && extra?.fieldTest === true) return parseCheapoApiOrigin(extra.cheapoApiOrigin);
  if (Platform.OS === "ios" && extra?.iosSharedShopping === true) return parseCheapoApiOrigin(extra.cheapoApiOrigin);
  return null;
}
