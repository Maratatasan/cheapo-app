import { priceAppendSchema, type PriceAppend } from '@cheapo/domain/price-append';

import { json, readJson, unauthorized } from './api-http.ts';

export { matchesReviewedUnitPrice, reviewedPrice, reviewedUnitPrice } from '@cheapo/domain/price-append';

export type PriceIdentity = { id: string; sourceId: string; version: number };
type PriceAppendResult =
  | { status: 'created' | 'replayed'; identity: PriceIdentity }
  | { status: 'unauthenticated' | 'forbidden' | 'invalid_reference' | 'source_conflict' };
export type ExecutePriceAppend = (digest: string, observation: PriceAppend) => Promise<PriceAppendResult>;

export async function appendPriceObservation(request: Request, digest: string, execute: ExecutePriceAppend): Promise<Response> {
  if (new URL(request.url).searchParams.size) return json({ error: 'invalid_price' }, 400);
  const body = await readJson(request, 8192, 'invalid_price');
  if (body instanceof Response) return body;
  const parsed = priceAppendSchema.safeParse(body.value);
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
