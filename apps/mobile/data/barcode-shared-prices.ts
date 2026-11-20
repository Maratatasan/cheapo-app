import type { Product } from '@cheapo/domain';
import { priceHistoryQuery, type PriceHistoryQuery, type PriceObservation } from '@cheapo/domain/price-history';

import { openCheapoSavedPriceReads } from './cheapo-shopping-read-device';
import { loadSavedPriceRecords } from './local-photo';
import { comparisonRowFromSavedHistory, keptSharedPrice, projectLocalPrice, projectSharedPrice, savedPriceHistoryRows } from './saved-price-history';
import type { CheapoShoppingRuntime } from './shopping-sync-runtime';

type ScopePage = {
  query: PriceHistoryQuery;
  observations: PriceObservation[];
  nextCursor: string | null;
  lastSyncedAt?: string;
  cached?: boolean;
  unavailable?: boolean;
};

export function barcodePriceQueries(product: Product): PriceHistoryQuery[] {
  const exact = priceHistoryQuery.parse({ limit: 25, productId: product.id });
  if (!product.productType && !product.comparableGroupId) return [exact];
  const related = priceHistoryQuery.safeParse({
    limit: 25, productType: product.productType, comparableGroupId: product.comparableGroupId,
  });
  return related.success ? [exact, related.data] : [exact];
}

type Runtime = Pick<CheapoShoppingRuntime, 'owner' | 'assertOwner' | 'priceQueue' | 'loadPriceChanges'>;

function comparedType(value: unknown) {
  return typeof value === 'string' ? value.trim().normalize('NFC').toLowerCase().replace(/\s+/g, ' ') : undefined;
}

export async function loadSharedBarcodePrices(shopping: Runtime, product: Product, shopId: string | undefined,
  signal: AbortSignal, previous?: ScopePage[], localOnly = false) {
  await shopping.assertOwner();
  const reader = localOnly ? undefined : await openCheapoSavedPriceReads(shopping.owner);
  const scopes = previous ?? barcodePriceQueries(product).map((query): ScopePage => ({
    query, observations: [], nextCursor: null,
  }));
  const [legacy, queue, changes, pages] = await Promise.all([
    loadSavedPriceRecords(), shopping.priceQueue.read(), shopping.loadPriceChanges(),
    Promise.all(scopes.map(async (scope): Promise<ScopePage> => {
      if (!reader) return { ...scope, unavailable: true };
      if (previous && !scope.nextCursor) return scope;
      const result = await reader.loadPriceHistory({ ...scope.query, cursor: scope.nextCursor ?? undefined }, signal);
      if (result.status === 'unavailable') return { ...scope, unavailable: true };
      return { query: scope.query, observations: [...scope.observations, ...result.value.observations],
        nextCursor: result.value.nextCursor, lastSyncedAt: result.lastSyncedAt,
        cached: Boolean(scope.cached || result.status === 'cached') };
    })),
  ]);
  reader?.assertCurrent();
  await shopping.assertOwner();
  if (signal.aborted) throw Error('Barcode price lookup stopped.');
  const [exactPage, relatedPage] = pages;
  const offlineChanges = changes.filter(change => {
    if (!change.resourceId || change.change.action !== 'keep_cloud') return false;
    const kept = keptSharedPrice(change.resourceId, [change]);
    if (!kept) return false;
    if (kept.productId === product.id) return Boolean(exactPage?.cached || exactPage?.unavailable);
    const queryType = comparedType(relatedPage?.query.productType);
    return Boolean(queryType && (relatedPage?.cached || relatedPage?.unavailable) && queryType === comparedType(kept.review?.productType));
  });
  const rows = savedPriceHistoryRows({
    legacy, queued: queue.entries, shared: pages.flatMap(page => page.observations), offlineChanges,
  })
    .flatMap(history => {
      const row = comparisonRowFromSavedHistory(history, changes);
      return row ? [{ history, row }] : [];
    });
  const exact = rows.filter(({ row }) => row.productId === product.id);
  const reference = exact[0];
  const current = shopId ? exact.find(({ history }) => {
    const branch = history.source === 'shared' ? projectSharedPrice(history.observation, changes).display.shopId
      : projectLocalPrice(history, changes).display.shop?.id;
    return branch === shopId;
  }) : undefined;
  const referenceObservation = reference?.history.source === 'shared'
    ? projectSharedPrice(reference.history.observation, changes).display : undefined;
  const referencePhoto = reader && referenceObservation?.photos.length
    ? { id: referenceObservation.id, version: referenceObservation.version } : undefined;
  const photo = reference?.history.source !== 'shared' ? reference?.history.record.selected?.uri : undefined;
  const lastSyncedAt = pages.flatMap(page => page.lastSyncedAt ? [page.lastSyncedAt] : []).sort().at(0);
  return { comparisons: rows.map(({ row }) => row), reference: reference?.row, currentPrice: current?.row, photo,
    history: { pages, lastSyncedAt, referencePhoto, unavailable: pages.some(page => page.unavailable),
      cached: pages.some(page => page.cached), hasMore: pages.some(page => page.nextCursor) } };
}

export type BarcodeSharedPriceHistory = Awaited<ReturnType<typeof loadSharedBarcodePrices>>['history'];

export async function loadSharedBarcodePhoto(shopping: Runtime, id: string, signal: AbortSignal) {
  const reads = await openCheapoSavedPriceReads(shopping.owner);
  const [detail, changes] = await Promise.all([reads.loadPriceObservation(id, signal), shopping.loadPriceChanges()]);
  reads.assertCurrent();
  await shopping.assertOwner();
  const observed = detail.status === 'unavailable' ? undefined : detail.value.observation ?? undefined;
  const kept = observed || detail.status !== 'fresh' ? keptSharedPrice(id, changes, observed?.version) : undefined;
  const checked = kept ?? observed;
  const observation = checked && projectSharedPrice(checked, changes).display;
  const role = observation?.selectedPhotoRole;
  if (!observation || !role || signal.aborted) return undefined;
  const photo = await reads.loadSelectedPhoto(observation, role, signal);
  reads.assertCurrent();
  await shopping.assertOwner();
  if (!signal.aborted && photo.status !== 'unavailable') return photo.value.uri;
}
