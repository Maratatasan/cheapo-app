import Constants from "expo-constants";
import { Platform } from "react-native";

import { parseCheapoApiOrigin } from "./client";

export function fieldCheapoApiOrigin() {
  const extra = Constants.expoConfig?.extra;
  return Platform.OS === "android" && extra?.fieldTest === true
    ? parseCheapoApiOrigin(extra.cheapoApiOrigin)
    : null;
}
