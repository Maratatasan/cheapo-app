import { z } from 'zod';

import { json, readJson, unauthorized } from './api-http.ts';

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

const input = z.strictObject({
  sourceId: stableId,
  capturedAt: z.iso.datetime({ offset: true }).refine(value => !/\.\d{7}/.test(value)),
  productId: stableId.nullish(),
  shopId: stableId,
  shopDisplayName: observedName,
  review: reviewedPrice,
  unitPrice: reviewedUnitPrice.nullish(),
}).refine(matchesReviewedUnitPrice);

export function matchesReviewedUnitPrice(value: {
  review: z.infer<typeof reviewedPrice>; unitPrice?: z.infer<typeof reviewedUnitPrice> | null;
}): boolean {
  const { unitPrice: rawAmount, unit } = value.review;
  if (!rawAmount && !unit) return true;
  return !!rawAmount && /^\d+(?:\.\d{1,6})?$/.test(rawAmount) && !!unit &&
    value.unitPrice?.amount === Number(rawAmount) && value.unitPrice.unit === unit;
}

export type PriceAppend = z.infer<typeof input>;
export type PriceIdentity = { id: string; sourceId: string; version: number };
type PriceAppendResult =
  | { status: 'created' | 'replayed'; identity: PriceIdentity }
  | { status: 'unauthenticated' | 'forbidden' | 'invalid_reference' | 'source_conflict' };
export type ExecutePriceAppend = (digest: string, observation: PriceAppend) => Promise<PriceAppendResult>;

export async function appendPriceObservation(request: Request, digest: string, execute: ExecutePriceAppend): Promise<Response> {
  if (new URL(request.url).searchParams.size) return json({ error: 'invalid_price' }, 400);
  const body = await readJson(request, 8192, 'invalid_price');
  if (body instanceof Response) return body;
  const parsed = input.safeParse(body.value);
  if (!parsed.success) return json({ error: 'invalid_price' }, 400);

  try {
    const result = await execute(digest, parsed.data);
    switch (result.status) {
      case 'created': return json(result.identity, 201);
      case 'replayed': return json(result.identity);
      case 'unauthenticated': return unauthorized();
      case 'forbidden': return json({ error: 'forbidden' }, 403);
      case 'invalid_reference': return json({ error: 'invalid_reference' }, 422);
      case 'source_conflict': return json({ error: 'source_conflict' }, 409);
    }
  } catch {
    return json({ error: 'price_history_unavailable' }, 503);
  }
}
