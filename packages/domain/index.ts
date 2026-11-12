import { z } from 'zod';

import { normalizeName } from '@cheapo/domain/names';

const stableId = z.string().regex(/^\S+$/u);
const nonblankText = z.string().trim().min(1);
const name = z.preprocess(normalizeName, z.string());

export const shopSchema = z.object({
  id: stableId,
  name,
  nickname: z.string().trim().optional(),
  address: nonblankText.optional(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  }).optional(),
});

export type Shop = z.infer<typeof shopSchema>;

export function shopDisplayName(shop: Pick<Shop, 'name' | 'nickname'>): string {
  return normalizeName(shop.nickname) ?? shop.name;
}

export const productSchema = z.object({
  id: stableId,
  name,
  brand: nonblankText.optional(),
  barcode: z.string().regex(/^\d+$/u).optional(),
  pack: z.object({
    quantity: z.number().positive(),
    unit: nonblankText,
  }).optional(),
  photoIds: z.array(stableId).optional(),
  comparableGroupId: stableId.optional(),
});

export type Product = z.infer<typeof productSchema>;
