import { cheapoAccess } from "../lib/cheapo-access/device";
import { createCheapoShoppingReads } from "./cheapo-shopping-reads";
import { cheapoShoppingReadCache } from "./cheapo-shopping-read-cache";

export const cheapoShoppingReads = cheapoAccess
  ? createCheapoShoppingReads(cheapoAccess.openReadSession, cheapoShoppingReadCache)
  : null;
