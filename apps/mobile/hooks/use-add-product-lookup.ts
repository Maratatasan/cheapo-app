import { useMemo } from 'react';

import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import type { AddProductLookup } from '@/data/add-product-lookup';
import { createOwnerShoppingReads } from '@/data/cheapo-shopping-read-device';
import { useEnrolledCatalog } from './use-enrolled-catalog';

export function useAddProductLookup(): AddProductLookup | undefined {
  const shopping = useCheapoShopping();
  const catalog = useEnrolledCatalog();
  return useMemo(() => {
    if (!shopping || !catalog) return;
    const reads = createOwnerShoppingReads(shopping.owner);
    return {
      findByBarcode: catalog.findByBarcode,
      async findCandidates(identity, signal) {
        const result = await reads.searchProductCandidates(identity, signal);
        if (result.status !== 'fresh') throw Error('Catalog is unavailable.');
        return result.value;
      },
    };
  }, [shopping, catalog]);
}
