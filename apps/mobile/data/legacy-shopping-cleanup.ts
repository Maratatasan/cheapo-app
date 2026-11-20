import { clearLegacyPriceRecords } from './local-photo';
import { clearLegacyProductCatalog } from './local-products';
import { clearLegacySavedShops } from './local-shops';
import type { CheapoShoppingRuntime } from './shopping-sync-runtime';

type CleanupShopping = Pick<CheapoShoppingRuntime, 'assertOwner' | 'priceQueue' | 'mutationQueue'>;
export type LegacyCleanupResult = {
  removedPrices: number;
  keptPrices: number;
  failedParts: number;
  barcodeCatalog: 'cleared' | 'kept' | 'incomplete';
  savedShopsCleared: boolean;
};

export async function clearLegacyShopping(shopping: CleanupShopping): Promise<LegacyCleanupResult> {
  await shopping.assertOwner();
  const prices = await shopping.mutationQueue.withProtectedPriceReferences(editedPrices =>
    clearLegacyPriceRecords(clear => shopping.priceQueue.withProtectedPriceSources(queuedPrices =>
      clear(new Set([...queuedPrices, ...editedPrices]))), shopping.assertOwner));
  const keepCatalog = prices.keptPrices > 0 || prices.failedParts > 0;
  const result: LegacyCleanupResult = { ...prices, barcodeCatalog: keepCatalog ? 'kept' : 'incomplete', savedShopsCleared: false };
  if (!keepCatalog) {
    try {
      const catalogFailures = await clearLegacyProductCatalog(shopping.assertOwner);
      result.failedParts += catalogFailures;
      result.barcodeCatalog = catalogFailures ? 'incomplete' : 'cleared';
    } catch {
      result.failedParts++;
    }
  }
  try {
    await clearLegacySavedShops(shopping.assertOwner);
    result.savedShopsCleared = true;
  } catch {
    result.failedParts++;
  }
  return result;
}
