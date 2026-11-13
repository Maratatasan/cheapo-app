import { normalizeName } from '@cheapo/domain/names';
import { normalizedUnitPrice } from './comparison-prices';
import type { ProductMetadata } from './product-metadata';

export type ManualReview = ProductMetadata & { productName: string; packSize?: string; price: string; currency: string; shop: string; unitPrice: string; unit: string };
export const emptyReview = (shop = ''): ManualReview => ({ productName: '', price: '', currency: 'GBP', shop, unitPrice: '', unit: '' });
export const packSizeMaxLength = 50;
const validPrice = (value: string, fraction = 2) => new RegExp(`^\\d+(\\.\\d{1,${fraction}})?$`).test(value.trim()) && value.length <= 24 && Number(value) > 0 && Number(value) <= 9999999.99;

function packParts(pack: string) {
  const match = /^(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*([a-z]+)$/i.exec(pack.trim());
  if (!match) return null;
  const count = Number(match[1] ?? 1);
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return { count, quantity: match[2], unit: match[3] };
}

export function calculatePackUnitPrice(total: string, pack: string) {
  const parts = packParts(pack);
  if (!validPrice(total) || !parts) return null;
  return normalizedUnitPrice({ amount: Number(total) / parts.count, unit: `${parts.quantity} ${parts.unit}` });
}

export function productPackFromText(value: string) {
  const label = value.trim();
  const parts = packParts(label);
  if (!parts || !calculatePackUnitPrice('1', label)) return undefined;
  const quantity = Number(parts.quantity) * parts.count;
  return Number.isFinite(quantity) ? { quantity, unit: parts.unit, label } : undefined;
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
