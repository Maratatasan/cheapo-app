import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useShopRepository } from "@/component/shop/shop-repository-provider";
import { useCheapoShopping } from "@/component/cheapo-shopping-provider";
import type { SavedShopState, ShopRepository } from "@/data/shop-repository";

export function useSavedShops() {
  const shopRepository = useShopRepository();
  const shopping = useCheapoShopping();
  const [snapshot, setSnapshot] = useState<{ repository: ShopRepository; value: SavedShopState }>();
  const readRevision = useRef(0);
  const shops = snapshot?.repository === shopRepository ? snapshot.value : undefined;
  const setShops = useCallback((value: SavedShopState) => {
    readRevision.current += 1;
    setSnapshot({ repository: shopRepository, value });
  }, [shopRepository]);
  const [readError, setReadError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(useCallback(() => {
    let focused = true;
    async function load() {
      const revision = ++readRevision.current;
      try {
        const state = await shopRepository.loadSavedShops();
        if (focused && revision === readRevision.current) {
          setShops(state);
          setReadError(undefined);
        }
      } catch {
        if (focused && revision === readRevision.current) {
          setSnapshot(undefined);
          setReadError("Could not read saved shops. Try again.");
        }
      }
    }
    const unsubscribe = shopping?.subscribeSync((_result, updated) => {
      if (updated.has('save-shop') || updated.has('edit-shop') || updated.has('unlink-shop') || updated.has('select-shop')) void load();
    });
    void load();
    return () => { focused = false; unsubscribe?.(); };
  }, [attempt, setShops, shopRepository, shopping]));

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
