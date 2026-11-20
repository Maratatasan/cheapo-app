import { clearLegacyPriceRecords } from './local-photo';
import { clearLegacyProductCatalog } from './local-products';
import { clearLegacySavedShops } from './local-shops';
import type { CheapoShoppingRuntime } from './shopping-sync-runtime';

type CleanupShopping = Pick<CheapoShoppingRuntime, 'assertOwner' | 'priceQueue' | 'mutationQueue'>;
export type LegacyCleanupResult = { removedPrices: number; keptPrices: number; failedParts: number };

export async function clearLegacyShopping(shopping: CleanupShopping): Promise<LegacyCleanupResult> {
  await shopping.assertOwner();
  const result = await shopping.mutationQueue.withProtectedPriceReferences(editedPrices =>
    clearLegacyPriceRecords(clear => shopping.priceQueue.withProtectedPriceSources(async queuedPrices => {
      await shopping.assertOwner();
      return clear(new Set([...queuedPrices, ...editedPrices]));
    })));
  try {
    await shopping.assertOwner();
    result.failedParts += await clearLegacyProductCatalog();
    await shopping.assertOwner();
    await clearLegacySavedShops();
  } catch {
    result.failedParts++;
  }
  return result;
}
