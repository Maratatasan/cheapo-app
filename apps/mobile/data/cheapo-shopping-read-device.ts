import { cheapoAccess } from "../lib/cheapo-access/device";
import { CheapoAccessError } from "../lib/cheapo-access/client";
import { createCheapoPricePhotoRead } from "./cheapo-price-photo-read";
import { createCheapoShoppingReads } from "./cheapo-shopping-reads";
import { cheapoPricePhotoCache, cheapoShoppingReadCache } from "./cheapo-shopping-read-cache";
import type { PriceQueueOwner } from "./price-append-queue";

export const cheapoShoppingReads = cheapoAccess
  ? createCheapoShoppingReads(cheapoAccess.openReadSession, cheapoShoppingReadCache)
  : null;

export const cheapoPricePhotoRead = cheapoAccess
  ? createCheapoPricePhotoRead(cheapoAccess.openReadSession, cheapoPricePhotoCache)
  : null;

export async function openCheapoSavedPriceReads(owner: PriceQueueOwner) {
  if (!cheapoAccess) throw new CheapoAccessError("Cheapo shopping access is unavailable.");
  const session = await cheapoAccess.openReadSession();
  const verified = await cheapoAccess.lastVerifiedOwner();
  session.assertCurrent();
  if (!verified || verified.origin !== owner.origin || verified.householdId !== owner.householdId || verified.shopperId !== owner.shopperId) {
    throw new CheapoAccessError("Cheapo access changed. Try again.");
  }
  const openBound = async () => {
    session.assertCurrent();
    return session;
  };
  const { loadPriceHistory, loadPriceObservation } = createCheapoShoppingReads(openBound, cheapoShoppingReadCache);
  return {
    loadPriceHistory, loadPriceObservation, assertCurrent: session.assertCurrent,
    loadPhoto: createCheapoPricePhotoRead(openBound, cheapoPricePhotoCache),
  };
}
