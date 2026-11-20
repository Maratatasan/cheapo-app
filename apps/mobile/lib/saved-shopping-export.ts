import { loadSavedShops } from '@/data/local-shops';
import type { PriceQueueOwner } from '@/data/price-append-queue';

export async function exportSavedShopping(signal: AbortSignal, owner?: PriceQueueOwner) {
  const { exportShoppingData } = await import('./shopping-export').catch(() => {
    throw Error('Sharing is unavailable in this build.');
  });
  const loadProtected = owner ? async () => {
    const { loadEnrolledShoppingBackup } = await import('./enrolled-shopping-backup');
    return loadEnrolledShoppingBackup(owner);
  } : undefined;
  // Keep original pre-enrollment shop records in the legacy portion of the ZIP.
  // The owner's versioned shop operations are preserved in the v4 recovery files.
  await exportShoppingData(signal, { loadSavedShops }, loadProtected);
}
