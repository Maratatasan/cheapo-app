import { productSchema, shopSchema, type Product, type Shop } from "@cheapo/domain";
import { canonicalProductBarcode } from "@cheapo/domain/product-barcode";
import type { PriceHistoryQuery, PriceObservationDetail } from "@cheapo/domain/price-history";
import { CheapoAccessError, type CheapoReadSession } from "../lib/cheapo-access/client";
import { decodeHistoryObservation, decodeHistoryPage, historyObservationPath, historyPagePath } from "./cheapo-price-history";

export type ReadCache = {
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type ShoppingRead<T> =
  | { status: "fresh" | "cached"; value: T; lastSyncedAt: string }
  | { status: "unavailable" };

type SavedShop = Shop & { testShop?: boolean };
type SavedShopRead = { shops: SavedShop[]; currentShop?: SavedShop };
type ShopCandidate = Pick<Shop, "id" | "name" | "address" | "location">;
type Decoder<T> = (raw: unknown) => T;

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
function decodeProduct(value: unknown): { product: Product | null } {
  const { product } = object(value);
  if (product === null) return { product: null };
  const result = canonicalProduct.safeParse(product);
  if (!result.success || (result.data.barcode && canonicalProductBarcode(result.data.barcode) !== result.data.barcode)) return malformed();
  return { product: result.data };
}

export function createCheapoShoppingReads(openSession: () => Promise<CheapoReadSession>, cache: ReadCache) {
  async function read<T>(
    path: string, decode: Decoder<T>, cacheable: ((value: T) => boolean) | undefined, signal?: AbortSignal,
    notFound?: () => T,
  ): Promise<ShoppingRead<T>> {
    const session = await openSession();
    const key = `${session.cacheScope}\0${path}`;

    async function fromCache(): Promise<ShoppingRead<T>> {
      let result: ShoppingRead<T> = { status: "unavailable" };
      if (cacheable) {
        try {
          const text = await cache.read(key);
          if (text) {
            const snapshot = object(JSON.parse(text));
            const { lastSyncedAt } = snapshot;
            if (typeof lastSyncedAt === "string" && Number.isFinite(Date.parse(lastSyncedAt))) {
              const value = decode(snapshot.body);
              if (cacheable(value)) result = { status: "cached", value, lastSyncedAt };
            }
          }
        } catch {
          // A removed or damaged cache file is replaceable.
        }
      }
      session.assertCurrent();
      return result;
    }

    let response: Response;
    try {
      response = await session.get(path, signal);
    } catch (error) {
      if (error instanceof CheapoAccessError || signal?.aborted) throw error;
      return fromCache();
    }
    if (response.status === 429 || response.status >= 500) return fromCache();
    if (!response.ok && (response.status !== 404 || !notFound)) throw Error("Could not read shopping data from Cheapo.");
    const value = response.status === 404 && notFound ? notFound() : decode(await response.json());
    session.assertCurrent();
    const lastSyncedAt = new Date().toISOString();
    if (cacheable) {
      try {
        if (cacheable(value)) await cache.write(key, JSON.stringify({ body: value, lastSyncedAt }));
        else await cache.remove(key);
      } catch {
        // A cache write failure does not invalidate the checked response.
      }
    }
    session.assertCurrent();
    return { status: "fresh", value, lastSyncedAt };
  }

  return {
    loadSavedShops: (signal?: AbortSignal) => read("/v1/me/saved-shops", decodeSavedShops, () => true, signal),
    searchShopCandidates(query: string, signal?: AbortSignal) {
      return read(`/v1/shops?${new URLSearchParams({ query })}`, decodeCandidates, undefined, signal);
    },
    findProductByBarcode(barcode: string, signal?: AbortSignal) {
      const gtin = canonicalProductBarcode(barcode);
      if (!gtin) throw Error("Enter a valid product barcode.");
      return read(`/v1/products?gtin=${gtin}`, decodeProduct, value => value.product !== null, signal);
    },
    findProductById(id: string, signal?: AbortSignal) {
      if (!productSchema.shape.id.safeParse(id).success || id === "." || id === ".." || id.includes("\0")) throw Error("Invalid product ID.");
      return read(`/v1/products/${encodeURIComponent(id)}`, decodeProduct, value => value.product !== null, signal);
    },
    loadPriceHistory(query: PriceHistoryQuery = {}, signal?: AbortSignal) {
      return read(historyPagePath(query), decodeHistoryPage, () => true, signal);
    },
    loadPriceObservation(id: string, signal?: AbortSignal) {
      return read<{ observation: PriceObservationDetail | null }>(
        historyObservationPath(id), raw => decodeHistoryObservation(raw, id), value => value.observation !== null, signal,
        () => ({ observation: null }),
      );
    },
  };
}
