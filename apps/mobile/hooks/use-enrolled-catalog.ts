import { useMemo } from 'react';

import { useCheapoShopping } from '@/component/cheapo-shopping-provider';
import { createOwnerShoppingReads } from '@/data/cheapo-shopping-read-device';
import { createEnrolledCatalog } from '@/data/enrolled-catalog';

export function useEnrolledCatalog() {
  const runtime = useCheapoShopping();
  return useMemo(() => {
    if (!runtime) return null;
    const reads = createOwnerShoppingReads(runtime.owner);
    return createEnrolledCatalog({
      queue: runtime.mutationQueue,
      readByBarcode: reads.findEditableProductByBarcode,
      readById: reads.findEditableProductById,
      sync: runtime.retry,
      assertCurrent: runtime.assertOwner,
    });
  }, [runtime]);
}
