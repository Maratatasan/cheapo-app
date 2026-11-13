import { createContext, useContext, type ReactNode } from 'react';
import type { ShopRepository } from '@/data/shop-repository';

const ShopRepositoryContext = createContext<ShopRepository | undefined>(undefined);

export function ShopRepositoryProvider({ repository, children }: { repository: ShopRepository; children: ReactNode }) {
  return <ShopRepositoryContext.Provider value={repository}>{children}</ShopRepositoryContext.Provider>;
}

export function useShopRepository(): ShopRepository {
  const repository = useContext(ShopRepositoryContext);
  if (!repository) throw Error('Shop repository is not configured.');
  return repository;
}
