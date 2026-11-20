import { cheapoAccess } from "../lib/cheapo-access/device";
import { CheapoAccessError } from "../lib/cheapo-access/client";
import { renderSelectedPriceCrop } from "../lib/render-selected-price-crop";
import { createCheapoPricePhotoRead } from "./cheapo-price-photo-read";
import { createCheapoShoppingReads } from "./cheapo-shopping-reads";
import { cheapoPricePhotoCache, cheapoShoppingReadCache } from "./cheapo-shopping-read-cache";
import type { PriceQueueOwner } from "./price-append-queue";
import { createSelectedPricePhotoRead } from "./selected-price-photo-read";

export const cheapoShoppingReads = cheapoAccess
  ? createCheapoShoppingReads(cheapoAccess.openReadSession, cheapoShoppingReadCache)
  : null;

export const cheapoPricePhotoRead = cheapoAccess
  ? createCheapoPricePhotoRead(cheapoAccess.openReadSession, cheapoPricePhotoCache)
  : null;

async function openOwnerReadSession(owner: PriceQueueOwner) {
  if (!cheapoAccess) throw new CheapoAccessError("Cheapo shopping access is unavailable.");
  const session = await cheapoAccess.openReadSession();
  const verified = await cheapoAccess.lastVerifiedOwner();
  session.assertCurrent();
  if (!verified || verified.origin !== owner.origin || verified.householdId !== owner.householdId || verified.shopperId !== owner.shopperId) {
    throw new CheapoAccessError("Cheapo access changed. Try again.");
  }
  return session;
}

export function createOwnerShoppingReads(owner: PriceQueueOwner) {
  return createCheapoShoppingReads(() => openOwnerReadSession(owner), cheapoShoppingReadCache);
}

export async function openCheapoSavedPriceReads(owner: PriceQueueOwner) {
  const session = await openOwnerReadSession(owner);
  const openBound = async () => {
    session.assertCurrent();
    return session;
  };
  const { loadPriceHistory, loadPriceObservation } = createCheapoShoppingReads(openBound, cheapoShoppingReadCache);
  const loadPhoto = createCheapoPricePhotoRead(openBound, cheapoPricePhotoCache);
  const loadSelectedPhoto = createSelectedPricePhotoRead(session, cheapoPricePhotoCache, loadPhoto, renderSelectedPriceCrop);
  return {
    loadPriceHistory, loadPriceObservation, assertCurrent: session.assertCurrent, loadPhoto, loadSelectedPhoto,
    cached: {
      loadPriceHistory: (query: Parameters<typeof loadPriceHistory>[0], signal: AbortSignal) => loadPriceHistory(query, signal, 'cache-only'),
      loadPriceObservation: (id: string, signal: AbortSignal) => loadPriceObservation(id, signal, 'cache-only'),
      loadSelectedPhoto: (observation: Parameters<typeof loadSelectedPhoto>[0], role: Parameters<typeof loadSelectedPhoto>[1], signal: AbortSignal) =>
        loadSelectedPhoto(observation, role, signal, 'cache-only'),
    },
  };
}
