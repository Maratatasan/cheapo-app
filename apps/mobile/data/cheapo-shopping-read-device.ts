import { cheapoAccess } from "../lib/cheapo-access/device";
import { createCheapoPricePhotoRead } from "./cheapo-price-photo-read";
import { createCheapoShoppingReads } from "./cheapo-shopping-reads";
import { cheapoPricePhotoCache, cheapoShoppingReadCache } from "./cheapo-shopping-read-cache";

export const cheapoShoppingReads = cheapoAccess
  ? createCheapoShoppingReads(cheapoAccess.openReadSession, cheapoShoppingReadCache)
  : null;

export const cheapoPricePhotoRead = cheapoAccess
  ? createCheapoPricePhotoRead(cheapoAccess.openReadSession, cheapoPricePhotoCache)
  : null;
