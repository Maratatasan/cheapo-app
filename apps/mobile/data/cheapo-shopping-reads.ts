import { packagePriceBases, productSchema, shopSchema, type PackagePriceBasis, type Product, type Shop } from "@cheapo/domain";
import { canonicalProductBarcode } from "@cheapo/domain/product-barcode";
import { priceObservationId, type PriceHistoryQuery, type PriceObservationDetail } from "@cheapo/domain/price-history";
import { CheapoAccessError, type CheapoReadSession } from "../lib/cheapo-access/client";
import { requestInterrupted, withCheapoDeadline } from "../lib/cheapo-access/request-deadline";
import { mutationOperationId, savedShopVersion } from './shopping-mutations';
import { decodeHistoryObservation, decodeHistoryPage, historyObservationPath, historyPagePath } from "./cheapo-price-history";

export type ReadCache = {
  revision(): number;
  read(key: string, revision: number): Promise<string | null>;
  write(key: string, text: string, revision: number): Promise<void>;
  remove(key: string, revision: number): Promise<void>;
};

export type ShoppingRead<T> =
  | { status: "fresh" | "cached"; value: T; lastSyncedAt: string; observedOperationIds?: string[] }
  | { status: "unavailable" };

type SavedShop = Shop & { testShop?: boolean };
type SavedShopRead = { shops: SavedShop[]; currentShop?: SavedShop };
export type EditableSavedShopRead = SavedShopRead & { versions: { shopId: string; version: string }[] };
export type ShopCandidate = Pick<Shop, "id" | "name" | "address" | "location">;
type Decoder<T> = (raw: unknown, etag?: string | null) => T;
const readDeadlineMs = 35_000;

function malformed(): never {
  throw Error("Cheapo returned unreadable shopping data.");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return malformed();
  return value as Record<string, unknown>;
}

function readSavedShop(value: unknown): SavedShop {
  const raw = object(value);
  const shop = shopSchema.safeParse(raw);
  if (!shop.success || (raw.testShop !== undefined && typeof raw.testShop !== "boolean")) return malformed();
  return raw.testShop === undefined ? shop.data : { ...shop.data, testShop: raw.testShop };
}

function decodeSavedShops(value: unknown): SavedShopRead {
  const raw = object(value);
  if (!Array.isArray(raw.shops)) return malformed();
  const shops = raw.shops.map(readSavedShop);
  if (new Set(shops.map(shop => shop.id)).size !== shops.length) return malformed();
  if (raw.currentShop === undefined) return { shops };
  const selected = readSavedShop(raw.currentShop);
  const currentShop = shops.find(shop => shop.id === selected.id);
  return currentShop ? { shops, currentShop } : malformed();
}

function decodeEditableSavedShops(value: unknown): EditableSavedShopRead {
  const state = decodeSavedShops(value);
  const { versions } = object(value);
  if (!Array.isArray(versions) || versions.length !== state.shops.length) return malformed();
  const shopIds = new Set(state.shops.map(shop => shop.id));
  const paired = versions.map(raw => {
    const { shopId, version } = object(raw);
    const parsed = savedShopVersion.safeParse(version);
    if (typeof shopId !== 'string' || !shopIds.delete(shopId) || !parsed.success) return malformed();
    return { shopId, version: parsed.data };
  });
  return { ...state, versions: paired };
}

function decodeCandidates(value: unknown): ShopCandidate[] {
  const { shops } = object(value);
  if (!Array.isArray(shops)) return malformed();
  return shops.map(raw => {
    const value = object(raw);
    const id = shopSchema.shape.id.safeParse(value.id);
    const name = shopSchema.shape.name.safeParse(value.name);
    const address = shopSchema.shape.address.safeParse(value.address);
    const location = shopSchema.shape.location.safeParse(value.location);
    if (!id.success || !name.success || !address.success || !location.success) return malformed();
    return { id: id.data, name: name.data, address: address.data, location: location.data };
  });
}

const canonicalProduct = productSchema.omit({ photoIds: true });
function readCanonicalProduct(value: unknown): Product {
  const result = canonicalProduct.safeParse(value);
  if (!result.success || (result.data.barcode && canonicalProductBarcode(result.data.barcode) !== result.data.barcode)) return malformed();
  return result.data;
}

function decodeProduct(value: unknown): { product: Product | null } {
  const { product } = object(value);
  return { product: product === null ? null : readCanonicalProduct(product) };
}

export type ProductCandidateSearch = { name: string; brand?: string; variety?: string; packSize?: string };
type ProductCandidateDetails = Pick<Product, 'name' | 'productType' | 'brand' | 'variety' | 'pack'> & { packSize?: string };
export type ProductCandidate = { kind: 'catalog'; product: Product }
  | { kind: 'unlinked_observation'; observationId: string; details: ProductCandidateDetails };

const candidateDetails = productSchema.pick({ name: true, productType: true, brand: true, variety: true, pack: true });

function readProductCandidate(value: unknown): ProductCandidate {
  const item = object(value);
  if (item.kind === 'catalog') return { kind: 'catalog', product: readCanonicalProduct(item.product) };
  if (item.kind !== 'unlinked_observation') return malformed();
  const observationId = priceObservationId.safeParse(item.observationId);
  const details = candidateDetails.safeParse(item.details);
  const { packSize } = object(item.details);
  if (!observationId.success || !details.success
    || (packSize !== undefined && (typeof packSize !== 'string' || !packSize.trim()))) return malformed();
  return { kind: 'unlinked_observation', observationId: observationId.data,
    details: packSize === undefined ? details.data : { ...details.data, packSize } };
}

function decodeProductCandidates(value: unknown) {
  const { candidates, truncated } = object(value);
  if (!Array.isArray(candidates) || candidates.length > 8 || typeof truncated !== 'boolean') return malformed();
  return { candidates: candidates.map(readProductCandidate), truncated };
}

function productCandidatePath(identity: ProductCandidateSearch) {
  const { name, brand, variety, packSize } = identity;
  const parameters = new URLSearchParams({ name: name.trim() });
  for (const [key, value] of Object.entries({ brand, variety, packSize })) {
    if (value?.trim()) parameters.set(key, value.trim());
  }
  return `/v1/product-candidates?${parameters}`;
}

export type EditableProductRead = { product: Product; version: number } | { product: null };
export type ComparisonPreferenceRead = { basis: PackagePriceBasis | null; version: number };

function numericVersion(raw: unknown, etag?: string | null): number {
  const parsed = etag === undefined ? object(raw).version : /^"(0|[1-9][0-9]{0,9})"$/.exec(etag ?? '')?.[1];
  const version = typeof parsed === 'string' && etag !== undefined ? Number(parsed) : parsed;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || version > 2_147_483_647) return malformed();
  return version;
}

function decodeEditableProduct(value: unknown, etag?: string | null): EditableProductRead {
  const { product } = decodeProduct(value);
  if (!product) return { product: null };
  const version = numericVersion(value, etag);
  return version > 0 ? { product, version } : malformed();
}

function decodeComparisonPreference(value: unknown, etag?: string | null): ComparisonPreferenceRead {
  const version = numericVersion(value, etag);
  const requested = object(value).basis;
  const basis = requested === null ? null : packagePriceBases.find(item => item === requested);
  if (basis === undefined || (version === 0 && basis !== null)) return malformed();
  return { basis, version };
}

export function productPath(id: string) {
  if (!productSchema.shape.id.safeParse(id).success || id === '.' || id === '..' || id.includes('\0')) throw Error('Invalid product ID.');
  return `/v1/products/${encodeURIComponent(id)}`;
}

function barcodePath(barcode: string) {
  const gtin = canonicalProductBarcode(barcode);
  if (!gtin) throw Error('Enter a valid product barcode.');
  return `/v1/products?gtin=${gtin}`;
}

export function createCheapoShoppingReads(openSession: () => Promise<CheapoReadSession>, cache: ReadCache) {
  async function read<T>(
    path: string, decode: Decoder<T>, cacheable: ((value: T) => boolean) | undefined, signal?: AbortSignal,
    notFound?: () => T, { observedOperations, cacheVersioned, cacheOnly }: {
      observedOperations?: readonly string[]; cacheVersioned?: boolean; cacheOnly?: boolean;
    } = {},
  ): Promise<ShoppingRead<T>> {
    if (signal?.aborted) throw requestInterrupted();
    const revision = cache.revision();
    const session = await openSession();
    const key = `${session.cacheScope}\0${path}${cacheVersioned ? '\0versioned' : ''}`;

    function assertCurrent() {
      if (signal?.aborted || revision !== cache.revision()) throw requestInterrupted();
      session.assertCurrent();
    }

    async function fromCache(): Promise<ShoppingRead<T>> {
      let result: ShoppingRead<T> = { status: "unavailable" };
      if (cacheable) {
        try {
          const text = await cache.read(key, revision);
          if (text) {
            const snapshot = object(JSON.parse(text));
            const { lastSyncedAt } = snapshot;
            if (typeof lastSyncedAt === "string" && Number.isFinite(Date.parse(lastSyncedAt))) {
              const value = decode(snapshot.body);
              const observed = snapshot.observedOperationIds;
              const metadata = observedOperations && Array.isArray(observed)
                && observed.every(id => mutationOperationId.safeParse(id).success) ? { observedOperationIds: observed } : {};
              if (cacheable(value)) result = { status: "cached", value, lastSyncedAt, ...metadata };
            }
          }
        } catch {
          // A removed or damaged cache file is replaceable.
        }
      }
      assertCurrent();
      return result;
    }
    if (cacheOnly) return fromCache();

    let response: { ok: boolean; status: number; body: unknown; etag: string | null };
    try {
      response = await withCheapoDeadline(signal, readDeadlineMs, async stageSignal => {
        assertCurrent();
        const checked = await session.get(path, stageSignal);
        if (stageSignal.aborted) throw requestInterrupted();
        return { status: checked.status, ok: checked.ok, body: checked.ok ? await checked.json() : undefined,
          etag: checked.headers.get('ETag') };
      });
    } catch (error) {
      if (error instanceof CheapoAccessError || error instanceof SyntaxError || signal?.aborted) throw error;
      return fromCache();
    }
    if (response.status === 429 || response.status >= 500) return fromCache();
    if (!response.ok && (response.status !== 404 || !notFound)) throw Error("Could not read shopping data from Cheapo.");
    const value = response.status === 404 && notFound ? notFound() : decode(response.body, response.etag);
    assertCurrent();
    const lastSyncedAt = new Date().toISOString();
    const metadata = observedOperations ? { observedOperationIds: [...observedOperations] } : {};
    if (cacheable) {
      try {
        if (cacheable(value)) await cache.write(key, JSON.stringify({ body: value, lastSyncedAt, ...metadata }), revision);
        else await cache.remove(key, revision);
      } catch {
        // A cache write failure does not invalidate the checked response.
      }
    }
    assertCurrent();
    return { status: "fresh", value, lastSyncedAt, ...metadata };
  }

  return {
    loadSavedShops: (signal?: AbortSignal) => read("/v1/me/saved-shops", decodeSavedShops, () => true, signal),
    loadEditableSavedShops: (signal?: AbortSignal, observedOperations?: readonly string[]) =>
      read("/v1/me/saved-shops?includeVersions=true", decodeEditableSavedShops, () => true, signal, undefined, { observedOperations }),
    searchShopCandidates(query: string, signal?: AbortSignal) {
      return read(`/v1/shops?${new URLSearchParams({ query })}`, decodeCandidates, undefined, signal);
    },
    findProductByBarcode: (barcode: string, signal?: AbortSignal) =>
      read(barcodePath(barcode), decodeProduct, value => value.product !== null, signal),
    findProductById: (id: string, signal?: AbortSignal) =>
      read(productPath(id), decodeProduct, value => value.product !== null, signal),
    searchProductCandidates: (identity: ProductCandidateSearch, signal?: AbortSignal) =>
      read(productCandidatePath(identity), decodeProductCandidates, undefined, signal),
    findEditableProductByBarcode: (barcode: string, signal?: AbortSignal) =>
      read(barcodePath(barcode), decodeEditableProduct, value => value.product !== null, signal, undefined, { cacheVersioned: true }),
    findEditableProductById: (id: string, signal?: AbortSignal) =>
      read(productPath(id), decodeEditableProduct, value => value.product !== null, signal, undefined, { cacheVersioned: true }),
    loadComparisonPreference(groupId: string, signal?: AbortSignal) {
      if (!groupId.length || groupId.length > 128 || groupId !== groupId.trim()
        || groupId === '.' || groupId === '..' || /[\p{Cc}/]/u.test(groupId)) {
        throw Error('Invalid comparison group.');
      }
      return read(`/v1/me/comparison-preferences/${encodeURIComponent(groupId)}`, decodeComparisonPreference, () => true, signal);
    },
    loadPriceHistory(query: PriceHistoryQuery = {}, signal?: AbortSignal, mode?: 'cache-only') {
      return read(historyPagePath(query), decodeHistoryPage, () => true, signal, undefined, { cacheOnly: mode === 'cache-only' });
    },
    loadPriceObservation(id: string, signal?: AbortSignal, mode?: 'cache-only') {
      return read<{ observation: PriceObservationDetail | null }>(
        historyObservationPath(id), raw => decodeHistoryObservation(raw, id), value => value.observation !== null, signal,
        () => ({ observation: null }), { cacheOnly: mode === 'cache-only' },
      );
    },
  };
}
