import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useShopRepository } from "@/component/shop/shop-repository-provider";
import type { SavedShopState } from "@/data/shop-repository";

export function useSavedShops() {
  const shopRepository = useShopRepository();
  const [shops, setShops] = useState<SavedShopState>();
  const [readError, setReadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(useCallback(() => {
    let focused = true;
    shopRepository.loadSavedShops().then((state) => {
      if (!focused) return;
      setShops(state);
      setReadError(undefined);
    }).catch(() => {
      if (focused) setReadError("Could not read saved shops. Try again.");
    });
    return () => { focused = false; };
  }, [attempt, shopRepository]));

  return {
    shopRepository,
    shops,
    setShops,
    readError,
    retry: () => {
      setReadError(undefined);
      setAttempt((current) => current + 1);
    },
  };
}
