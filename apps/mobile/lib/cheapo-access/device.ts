import { fetch } from "expo/fetch";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { createCheapoAccess } from "./client";
import { fieldCheapoApiOrigin } from "./config";

const origin = fieldCheapoApiOrigin();
export const cheapoAccess = origin ? createCheapoAccess(origin, {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  deleteItem: SecureStore.deleteItemAsync,
}, fetch, value => digestStringAsync(CryptoDigestAlgorithm.SHA256, value)) : null;
