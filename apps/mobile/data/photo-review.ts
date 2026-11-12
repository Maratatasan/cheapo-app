import { normalizeName } from '@cheapo/domain/names';
import type { ProductMetadata } from './product-metadata';

export type ManualReview = ProductMetadata & { productName: string; price: string; currency: string; shop: string; unitPrice: string; unit: string };
export const emptyReview = (shop = ''): ManualReview => ({ productName: '', price: '', currency: 'GBP', shop, unitPrice: '', unit: '' });
const validPrice = (value: string, fraction = 2) => new RegExp(`^\\d+(\\.\\d{1,${fraction}})?$`).test(value.trim()) && value.length <= 24 && Number(value) > 0 && Number(value) <= 9999999.99;

export function reviewComplete(review?: ManualReview, selectedShopName?: string): boolean {
  if (!review) return false;
  const productName = normalizeName(review.productName);
  const shopName = normalizeName(selectedShopName ?? review.shop);

  return !!productName && productName.length <= 200
    && !!shopName && (selectedShopName !== undefined || shopName.length <= 150)
    && validPrice(review.price)
    && /^[A-Z]{3}$/.test(review.currency)
    && (
      (!review.unitPrice.trim() && !review.unit.trim())
      || (validPrice(review.unitPrice, 6) && !!review.unit.trim() && review.unit.trim().length <= 30)
    );
}
