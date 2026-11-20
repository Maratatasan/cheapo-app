import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ShopRepository } from '@/data/shop-repository';
import { createEnrolledSavedShops } from '@/data/enrolled-saved-shops';
import { cheapoShoppingReads } from '@/data/cheapo-shopping-read-device';
import { sameShoppingOwner } from '@/data/price-append-queue';
import { CheapoAccessError } from '@/lib/cheapo-access/client';
import { cheapoAccess } from '@/lib/cheapo-access/device';
import { useCheapoShopping } from '../cheapo-shopping-provider';

const ShopRepositoryContext = createContext<ShopRepository | undefined>(undefined);

export function ShopRepositoryProvider({ repository, children }: { repository: ShopRepository; children: ReactNode }) {
  const runtime = useCheapoShopping();
  const selected = useMemo(() => {
    const access = cheapoAccess;
    const readings = cheapoShoppingReads;
    if (!runtime || !access || !readings) return repository;
    return createEnrolledSavedShops({
      queue: runtime.mutationQueue,
      loadHosted: observed => readings.loadEditableSavedShops(undefined, observed),
      sync: runtime.retry,
      async assertCurrent() {
        if (!sameShoppingOwner(await access.lastVerifiedOwner(), runtime.owner)) {
          throw new CheapoAccessError('Cheapo access changed. Reopen shopping.');
        }
      },
    });
  }, [repository, runtime]);
  return <ShopRepositoryContext.Provider value={selected}>{children}</ShopRepositoryContext.Provider>;
}

export function useShopRepository(): ShopRepository {
  const repository = useContext(ShopRepositoryContext);
  if (!repository) throw Error('Shop repository is not configured.');
  return repository;
}
