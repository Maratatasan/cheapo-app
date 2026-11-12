import { normalizeName } from '@cheapo/domain/names';

import { reviewComplete, type LocalPhotoDraft } from './local-photo';

export function comparisonRowFromDraft({ id, capturedAt, review, shop }: LocalPhotoDraft) {
  if (!review || !reviewComplete(review, shop?.displayName)) return null;
  return {
    id,
    capturedOn: new Date(capturedAt).toISOString().slice(0, 10),
    shop: shop?.displayName ?? review.shop.trim(),
    product: review.productName.trim(),
    productType: normalizeName(review.productType),
    variety: normalizeName(review.variety),
    brand: normalizeName(review.brand),
    price: Number(review.price),
    currency: review.currency,
    unit_price: review.unitPrice.trim() ? { amount: Number(review.unitPrice), unit: review.unit.trim() } : null,
  };
}
