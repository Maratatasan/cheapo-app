import type { LocalPhotoDraft } from './local-photo';
import type { CheapoShoppingRuntime } from './shopping-sync-runtime';

export type PhotoPriceSource = Pick<LocalPhotoDraft, 'original' | 'selected' | 'cropBox' | 'capturedAt'>;
export type ProductPhotoPriceSource = { productId: string; owner: CheapoShoppingRuntime | null; source: PhotoPriceSource };

// A temporary comparison route carries only the lookup draft's opaque ID.
// The lookup screen retains and clears its local photo references.
export const productPhotoPriceSources = new Map<string, ProductPhotoPriceSource>();
