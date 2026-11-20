import type { Product } from '@cheapo/domain';
import { reviewedPackParts } from '@cheapo/domain/package-measures';

import type { ProductCandidate, ProductCandidateSearch } from './cheapo-shopping-reads';
import { requestInterrupted } from '../lib/cheapo-access/request-deadline';
import type { ManualReview } from './photo-review';
import { canonicalProductBarcode } from './product-barcode';

export type AddProductLookup = {
  findByBarcode: (barcode: string, signal: AbortSignal) => Promise<Product | undefined>;
  findCandidates: (identity: ProductCandidateSearch, signal: AbortSignal) => Promise<{
    candidates: ProductCandidate[];
    truncated: boolean;
  }>;
};

export type CheckedProductIdentity = {
  kind: 'checked'; barcode?: string; exact: boolean; candidates: ProductCandidate[]; truncated: boolean;
};
export type ProductIdentityCheck = CheckedProductIdentity
  | { kind: 'invalid'; message: string }
  | { kind: 'unavailable'; barcode?: string };

// Exact GTIN ownership takes precedence over reviewed package identity. An
// unavailable exact read cannot be reinterpreted as permission to add a code.
export async function checkProductIdentity(lookup: AddProductLookup, review: ManualReview,
  enteredBarcode: string, signal: AbortSignal): Promise<ProductIdentityCheck> {
  if (signal.aborted) throw requestInterrupted();
  const barcode = canonicalProductBarcode(enteredBarcode) ?? undefined;
  if (enteredBarcode.trim() && !barcode) return { kind: 'invalid', message: 'Enter a valid barcode or leave it blank.' };
  const name = review.productName.trim();
  try {
    if (barcode) {
      const product = await lookup.findByBarcode(barcode, signal);
      if (signal.aborted) throw requestInterrupted();
      if (product) return { kind: 'checked', barcode, exact: true, candidates: [{ kind: 'catalog', product }], truncated: false };
    }
    if (!name || [name, review.brand, review.variety].some(value => value?.trim()
      && (/\p{Cc}/u.test(value.trim()) || !/[\p{L}\p{N}]/u.test(value)))) {
      return { kind: 'invalid', message: 'Enter a product name and use letters or numbers in the packaging details.' };
    }
    const packSize = review.packSize?.trim();
    if (packSize) {
      const pack = reviewedPackParts(packSize);
      const quantity = pack && Number(pack.quantity) * pack.count;
      if (!quantity || !Number.isFinite(quantity)) {
        return { kind: 'invalid', message: 'Enter the pack quantity and unit, or leave the pack size blank.' };
      }
    }
    if (signal.aborted) throw requestInterrupted();
    const matches = await lookup.findCandidates({ name, brand: review.brand, variety: review.variety, packSize }, signal);
    if (signal.aborted) throw requestInterrupted();
    return { kind: 'checked', barcode, exact: false, ...matches };
  } catch (error) {
    if (signal.aborted) throw error;
    return { kind: 'unavailable', barcode };
  }
}
