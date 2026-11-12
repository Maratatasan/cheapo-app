import { normalizeName } from '@cheapo/domain/names';

import { reviewComplete, type LocalPhotoDraft } from './local-photo';

export function comparisonRowFromDraft({ id, review, shop }: LocalPhotoDraft) {
  if (!review || !reviewComplete(review, shop?.displayName)) return null;
  return {
    id,
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
