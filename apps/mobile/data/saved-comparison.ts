import { normalizeName } from '@cheapo/domain/names';

import type { SavedPriceRecord } from './local-photo';
import { reviewComplete, reviewUnitPrice } from './photo-review';

export function comparisonRowFromDraft({ id, capturedAt, review, shop }: SavedPriceRecord) {
  if (!review || !reviewComplete(review, shop?.displayName)) return null;
  return {
    id,
    capturedOn: new Date(capturedAt).toISOString().slice(0, 10),
    shop: shop?.displayName ?? review.shop.trim(),
    product: review.productName.trim(),
    pack: normalizeName(review.packSize),
    productType: normalizeName(review.productType),
    variety: normalizeName(review.variety),
    brand: normalizeName(review.brand),
    price: Number(review.price),
    currency: review.currency,
    unit_price: reviewUnitPrice(review),
  };
}
