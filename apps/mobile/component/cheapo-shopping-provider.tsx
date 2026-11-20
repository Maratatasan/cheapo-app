import { createContext, use, type ReactNode } from 'react';

import type { CheapoShoppingRuntime } from '../data/shopping-sync-runtime';

const ShoppingContext = createContext<CheapoShoppingRuntime | null>(null);

export function CheapoShoppingProvider({ runtime, children }: { runtime: CheapoShoppingRuntime | null; children: ReactNode }) {
  return <ShoppingContext value={runtime}>{children}</ShoppingContext>;
}

export function useCheapoShopping() {
  return use(ShoppingContext);
}
