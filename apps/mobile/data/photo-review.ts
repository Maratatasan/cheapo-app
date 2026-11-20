import { normalizeName } from '@cheapo/domain/names';
import { normalizedUnitPrice } from './comparison-prices';
import type { AiPriceDraft } from './ai-observation';
import type { ProductMetadata } from './product-metadata';
import { reviewedPackParts } from './reviewed-pack';

export type ManualReview = ProductMetadata & { productName: string; packSize?: string; price: string; currency: string; shop: string; unitPrice: string; unit: string };
export const emptyReview = (shop = ''): ManualReview => ({ productName: '', price: '', currency: 'GBP', shop, unitPrice: '', unit: '' });
export const isCurrencyCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

export function applyPhotoSuggestion(review: ManualReview, suggestion: AiPriceDraft, edited: ReadonlySet<keyof ManualReview>, linkedPrice = false): ManualReview {
  const keepEdit = <Field extends keyof ManualReview>(field: Field, value: ManualReview[Field] | null) => edited.has(field) ? review[field] : value ?? review[field];
  const keepUnitPrice = edited.has('unitPrice') || edited.has('unit');
  const suggestedCurrency = isCurrencyCode(suggestion.currency) ? suggestion.currency : null;
  const replacePackPrice = suggestion.price !== null && !edited.has('price');
  const replaceUnitPrice = suggestion.unit_price !== null && !keepUnitPrice;
  const retainMoney = (!!review.price.trim() && !replacePackPrice) || (!!review.unitPrice.trim() && !replaceUnitPrice);
  const currency = !edited.has('currency') && !retainMoney && (replacePackPrice || replaceUnitPrice)
    ? suggestedCurrency ?? review.currency : review.currency;
  const applyMoney = suggestedCurrency === currency;
  return {
    ...review,
    productName: linkedPrice ? review.productName : keepEdit('productName', suggestion.product),
    productType: linkedPrice ? review.productType : keepEdit('productType', suggestion.productType),
    variety: linkedPrice ? review.variety : keepEdit('variety', suggestion.variety),
    brand: linkedPrice ? review.brand : keepEdit('brand', suggestion.brand),
    packSize: review.packSize ?? suggestion.packSize ?? undefined,
    price: applyMoney ? keepEdit('price', suggestion.price?.toString() ?? null) : review.price,
    currency,
    unitPrice: applyMoney && !keepUnitPrice ? suggestion.unit_price?.amount.toString() ?? review.unitPrice : review.unitPrice,
    unit: applyMoney && !keepUnitPrice ? suggestion.unit_price?.unit ?? review.unit : review.unit,
  };
}

export const packSizeMaxLength = 50;
const validPrice = (value: string, fraction = 2) => new RegExp(`^\\d+(\\.\\d{1,${fraction}})?$`).test(value.trim()) && value.length <= 24 && Number(value) > 0 && Number(value) <= 9999999.99;

export function calculatePackUnitPrice(total: string, pack: string) {
  const parts = reviewedPackParts(pack);
  if (!validPrice(total) || !parts) return null;
  return normalizedUnitPrice({ amount: Number(total) / parts.count, unit: `${parts.quantity} ${parts.unit}` });
}

export function productPackFromText(value: string) {
  const label = value.trim();
  const parts = reviewedPackParts(label);
  if (!parts || !calculatePackUnitPrice('1', label)) return undefined;
  const quantity = Number(parts.quantity) * parts.count;
  return Number.isFinite(quantity) ? { quantity, unit: parts.unit, label } : undefined;
}

export function savedProductDetails(review: ManualReview) {
  return { name: review.productName, productType: review.productType, variety: review.variety?.trim() || undefined,
    brand: review.brand?.trim() || undefined, pack: productPackFromText(review.packSize ?? '') };
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
    && isCurrencyCode(review.currency)
    && (
      (!review.unitPrice.trim() && !review.unit.trim())
      || (validPrice(review.unitPrice, 6) && !!review.unit.trim() && review.unit.trim().length <= 30)
    );
}
