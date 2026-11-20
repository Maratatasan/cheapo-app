import { z } from 'zod';

const stableId = z.string().regex(/^[^\s\0]{1,128}$/);
const reviewText = z.string().trim().refine(value => !value.includes('\0'));
const observedName = reviewText.min(1).max(200);
const price = z.string().trim().max(24).regex(/^\d+(?:\.\d{1,2})?$/)
  .refine(value => Number(value) > 0 && Number(value) <= 9_999_999.99);
export const reviewedUnitPrice = z.strictObject({ amount: z.number().positive(), unit: reviewText.min(1).max(30) });
export const reviewedPrice = z.strictObject({
  productName: observedName,
  price,
  currency: z.string().regex(/^[A-Z]{3}$/),
  packSize: reviewText.max(50).optional(),
  productType: reviewText.max(120).optional(),
  brand: reviewText.max(120).optional(),
  variety: reviewText.max(120).optional(),
  unitPrice: reviewText.max(24).optional(),
  unit: reviewText.max(30).optional(),
});

const normalizedCoordinate = z.number().min(0).max(1);
export const normalizedCropBox = z.strictObject({
  left: normalizedCoordinate, top: normalizedCoordinate,
  right: normalizedCoordinate, bottom: normalizedCoordinate,
}).refine(box => box.left < box.right && box.top < box.bottom);

export const priceAppendSchema = z.strictObject({
  sourceId: stableId,
  capturedAt: z.iso.datetime({ offset: true }).refine(value => !/\.\d{7}/.test(value)),
  productId: stableId.nullish(),
  shopId: stableId,
  shopDisplayName: observedName,
  review: reviewedPrice,
  unitPrice: reviewedUnitPrice.nullish(),
  cropBox: normalizedCropBox.optional(),
}).refine(matchesReviewedUnitPrice);

export function matchesReviewedUnitPrice(value: {
  review: z.infer<typeof reviewedPrice>; unitPrice?: z.infer<typeof reviewedUnitPrice> | null;
}): boolean {
  const { unitPrice: rawAmount, unit } = value.review;
  if (!rawAmount && !unit) return true;
  return !!rawAmount && /^\d+(?:\.\d{1,6})?$/.test(rawAmount) && !!unit &&
    value.unitPrice?.amount === Number(rawAmount) && value.unitPrice.unit === unit;
}

export type PriceAppend = z.infer<typeof priceAppendSchema>;
