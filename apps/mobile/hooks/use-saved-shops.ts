import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { loadSavedShops, type SavedShopState } from "@/data/local-shops";

export function useSavedShops() {
  const [shops, setShops] = useState<SavedShopState>();
  const [readError, setReadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(useCallback(() => {
    let focused = true;
    loadSavedShops().then((state) => {
      if (!focused) return;
      setShops(state);
      setReadError(undefined);
    }).catch(() => {
      if (focused) setReadError("Could not read saved shops. Try again.");
    });
    return () => { focused = false; };
  }, [attempt]));

  return {
    shops,
    setShops,
    readError,
    retry: () => {
      setReadError(undefined);
      setAttempt((current) => current + 1);
    },
  };
}
