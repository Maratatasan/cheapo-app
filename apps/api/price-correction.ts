import { pricePhotoSelection } from '@cheapo/domain/price-history';
import { z } from 'zod';

import { json, readJson, unauthorized } from './api-http.ts';
import { matchesReviewedUnitPrice, reviewedPrice, reviewedUnitPrice } from './price-append.ts';
import type { PriceObservationDetail } from './price-history.ts';

const stableId = z.string().regex(/^[^\s\0]{1,128}$/);
const reviewText = z.string().trim().min(1).refine(value => !value.includes('\0'));
const common = { operationId: stableId, expectedVersion: z.int().min(1).max(2_147_483_647) };
const correction = z.discriminatedUnion('action', [
  z.strictObject({
    ...common, action: z.literal('correct'), review: reviewedPrice, unitPrice: reviewedUnitPrice.nullish(),
    productId: stableId.nullish(), photoSelection: pricePhotoSelection.optional(),
    shop: z.strictObject({ id: stableId, displayName: reviewText.max(200) }).optional(),
  }).refine(matchesReviewedUnitPrice),
  z.strictObject({ ...common, action: z.literal('record_in_error'), reason: reviewText.max(300) }),
  z.strictObject({ ...common, action: z.literal('undo_recorded_in_error') }),
]);

export type PriceCorrection = z.infer<typeof correction>;
type PriceCorrectionResult =
  | { status: 'ok'; observation: PriceObservationDetail }
  | { status: 'version_conflict'; current: PriceObservationDetail }
  | { status: 'unauthenticated' | 'forbidden' | 'not_found' | 'invalid_reference' | 'operation_conflict' | 'invalid_observation_state' };
export type ExecutePriceCorrection = (digest: string, id: string, action: PriceCorrection) => Promise<PriceCorrectionResult>;

export async function correctPriceObservation(
  request: Request, digest: string, id: string, execute: ExecutePriceCorrection,
): Promise<Response> {
  if (new URL(request.url).searchParams.size) return json({ error: 'invalid_correction' }, 400);
  const body = await readJson(request, 8192, 'invalid_correction');
  if (body instanceof Response) return body;
  const parsed = correction.safeParse(body.value);
  if (!parsed.success) return json({ error: 'invalid_correction' }, 400);
  try {
    const result = await execute(digest, id, parsed.data);
    switch (result.status) {
      case 'ok': return json({ observation: result.observation });
      case 'unauthenticated': return unauthorized();
      case 'forbidden': return json({ error: 'forbidden' }, 403);
      case 'not_found': return json({ error: 'observation_not_found' }, 404);
      case 'invalid_reference': return json({ error: 'invalid_reference' }, 422);
      case 'version_conflict': return json({ error: result.status, currentVersion: result.current.version, current: result.current }, 409);
      case 'operation_conflict':
      case 'invalid_observation_state': return json({ error: result.status }, 409);
    }
  } catch {
    return json({ error: 'price_history_unavailable' }, 503);
  }
}
