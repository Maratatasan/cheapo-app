import type { LocalPhotoDraft } from './local-photo';
import type { ManualReview } from './photo-review';
import type { CheapoShoppingRuntime } from './shopping-sync-runtime';

export type PhotoPriceSource = Pick<LocalPhotoDraft, 'original' | 'selected' | 'cropBox' | 'capturedAt'>;
export type ProductPhotoPriceSource = { productId: string; owner: CheapoShoppingRuntime | null; source: PhotoPriceSource };

// A temporary comparison route carries only the lookup draft's opaque ID.
// The lookup screen retains and clears its local photo references.
export const productPhotoPriceSources = new Map<string, ProductPhotoPriceSource>();

export type AddProductPhotoDetails = { barcode?: string; review?: Partial<ManualReview> };
export type AddProductPhotoSource = { owner: CheapoShoppingRuntime; draft: LocalPhotoDraft; details: AddProductPhotoDetails };
export const addProductPhotoSources = new Map<string, AddProductPhotoSource>();
