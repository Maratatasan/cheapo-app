import { z } from 'zod';

import { normalizedCropBox } from '@cheapo/domain/price-append';

const photoRole = z.enum(['original', 'crop']);
const photos = z.array(z.object({
  role: photoRole,
  width: z.int().positive(),
  height: z.int().positive(),
  availability: z.literal('pending').optional(),
})).max(2).refine(items => new Set(items.map(item => item.role)).size === items.length);

export const priceObservationId = z.uuid();
const priceObservation = z.object({
  id: priceObservationId,
  sourceId: z.string().min(1),
  ownedByCurrentShopper: z.boolean(),
  version: z.int().positive(),
  capturedAt: z.iso.datetime({ precision: 6 }),
  productId: z.string().nullable(),
  sourceProductId: z.string().nullable(),
  productName: z.string().nullable(),
  shopId: z.string().nullable(),
  sourceShopId: z.string().nullable(),
  shopDisplayName: z.string().nullable(),
  priceAmount: z.string().regex(/^\d+(?:\.\d+)?$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  review: z.record(z.string(), z.unknown()).nullable(),
  unitPrice: z.object({ amount: z.number(), unit: z.string() }).nullable(),
  recordedInErrorReason: z.string().min(1).optional(),
  photos,
});

const fraction = z.number().min(0).max(1);
const cropBox = z.object({ left: fraction, top: fraction, right: fraction, bottom: fraction })
  .refine(box => box.left < box.right && box.top < box.bottom);
export const pricePhotoSelection = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('original') }),
  z.strictObject({ role: z.literal('crop'), cropBox: normalizedCropBox }),
]);

const priceObservationDetail = priceObservation.extend({
  cropBox: cropBox.nullable(),
  selectedPhotoRole: photoRole.nullable(),
  cropSource: z.literal('original').optional(),
}).refine(observation => {
  if (observation.cropSource === 'original') {
    const hasOriginal = observation.photos.some(photo => photo.role === 'original');
    return observation.selectedPhotoRole === (hasOriginal ? observation.cropBox ? 'crop' : 'original' : null);
  }
  return observation.selectedPhotoRole === null ? observation.photos.length === 0
    : observation.photos.some(photo => photo.role === observation.selectedPhotoRole);
});

const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/);
export const priceHistoryPage = z.object({
  observations: z.array(priceObservation).max(50)
    .refine(items => new Set(items.map(item => item.id)).size === items.length),
  nextCursor: cursor.nullable(),
});
export const priceHistoryDetail = z.object({ observation: priceObservationDetail });

const filterId = z.string().regex(/^[^\s\0]{1,128}$/);
export const priceHistoryQuery = z.strictObject({
  limit: z.int().min(1).max(50).optional(),
  cursor: cursor.optional(),
  productId: filterId.optional(),
  sourceId: filterId.optional(),
  comparableGroupId: filterId.optional(),
  productType: z.string().trim().min(1).max(120).refine(value => !value.includes('\0')).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  includeRecordedInError: z.literal(true).optional(),
}).refine(query => !query.productId || (!query.comparableGroupId && !query.productType))
  .refine(query => !query.sourceId || !(query.cursor || query.productId || query.comparableGroupId || query.productType || query.currency))
  .refine(query => !query.includeRecordedInError
    || !(query.productId || query.comparableGroupId || query.productType || query.currency));

export type PriceHistoryQuery = z.input<typeof priceHistoryQuery>;
export type PriceObservation = z.infer<typeof priceObservation>;
export type PriceObservationDetail = z.infer<typeof priceObservationDetail>;

export type PricePhotoSelection = z.infer<typeof pricePhotoSelection>;
