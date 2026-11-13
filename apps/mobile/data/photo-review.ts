import { normalizeName } from '@cheapo/domain/names';
import { normalizedUnitPrice } from './comparison-prices';
import type { ProductMetadata } from './product-metadata';

export type ManualReview = ProductMetadata & { productName: string; packSize?: string; price: string; currency: string; shop: string; unitPrice: string; unit: string };
export const emptyReview = (shop = ''): ManualReview => ({ productName: '', price: '', currency: 'GBP', shop, unitPrice: '', unit: '' });
export const packSizeMaxLength = 50;
const validPrice = (value: string, fraction = 2) => new RegExp(`^\\d+(\\.\\d{1,${fraction}})?$`).test(value.trim()) && value.length <= 24 && Number(value) > 0 && Number(value) <= 9999999.99;

export function calculatePackUnitPrice(total: string, pack: string) {
  const basis = pack.trim().replace(/(items|litres|liters)$/i, unit => unit.slice(0, -1));
  if (!validPrice(total) || !/^\d+(?:\.\d+)?\s*[a-z]+$/i.test(basis)) return null;
  return normalizedUnitPrice({ amount: Number(total), unit: basis });
}

export function reviewUnitPrice(review: ManualReview) {
  if (review.unitPrice.trim() || review.unit.trim()) {
    return validPrice(review.unitPrice, 6) && review.unit.trim()
      ? { amount: Number(review.unitPrice), unit: review.unit.trim() } : null;
  }
  return calculatePackUnitPrice(review.price, review.packSize ?? '');
}

export function reviewComplete(review?: ManualReview, selectedShopName?: string): boolean {
  if (!review) return false;
  const productName = normalizeName(review.productName);
  const shopName = normalizeName(selectedShopName ?? review.shop);

  return !!productName && productName.length <= 200
    && !!shopName && (selectedShopName !== undefined || shopName.length <= 150)
    && validPrice(review.price)
    && (!review.packSize?.trim() || !!calculatePackUnitPrice(review.price, review.packSize))
    && /^[A-Z]{3}$/.test(review.currency)
    && (
      (!review.unitPrice.trim() && !review.unit.trim())
      || (validPrice(review.unitPrice, 6) && !!review.unit.trim() && review.unit.trim().length <= 30)
    );
}
