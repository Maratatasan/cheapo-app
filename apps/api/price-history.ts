import { z } from 'zod';

import { json, unauthorized } from './api-http.ts';
import { readCredentialDigest } from './credential.ts';

const collection = '/v1/me/price-observations';
const cursorFields = z.tuple([z.iso.datetime({ precision: 6 }), z.uuid()]);
const defaultLimit = 30;
const maxLimit = 50;

type PriceCursor = z.infer<typeof cursorFields>;
export type PriceHistoryPage = { limit: number; cursor?: PriceCursor };
export type PriceObservation = {
  id: string;
  sourceId: string;
  version: number;
  capturedAt: string;
  productId: string | null;
  sourceProductId: string | null;
  productName: string | null;
  shopId: string | null;
  sourceShopId: string | null;
  shopDisplayName: string | null;
  priceAmount: string | null;
  currency: string | null;
  review: Record<string, unknown> | null;
  unitPrice: { amount: number; unit: string } | null;
  photos: { role: 'original' | 'crop'; width: number; height: number }[];
};
type PriceHistoryResult =
  | { status: 'ok'; observations: PriceObservation[] }
  | { status: 'unauthenticated' | 'forbidden' };
export type ExecutePriceHistory = (digest: string, page: PriceHistoryPage) => Promise<PriceHistoryResult>;

export function isPriceHistoryPath(path: string): boolean {
  return path === collection;
}

function readCursor(value: string): PriceCursor | undefined {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(value)) return undefined;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return undefined;
    return cursorFields.safeParse(JSON.parse(bytes.toString('utf8'))).data;
  } catch {
    return undefined;
  }
}

function readPage(params: URLSearchParams): PriceHistoryPage | undefined {
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => key !== 'limit' && key !== 'cursor')) {
    return undefined;
  }
  const size = params.get('limit');
  if (size !== null && !/^[1-9]\d?$/.test(size)) return undefined;
  const limit = size === null ? defaultLimit : Number(size);
  if (limit > maxLimit) return undefined;
  const value = params.get('cursor');
  const cursor = value === null ? undefined : readCursor(value);
  if (value !== null && !cursor) return undefined;
  return { limit, cursor };
}

export function createPriceHistoryHandler(execute: ExecutePriceHistory) {
  return async (request: Request): Promise<Response> => {
    const digest = readCredentialDigest(request.headers.get('Authorization'));
    if (!digest) return unauthorized();
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });

    const page = readPage(new URL(request.url).searchParams);
    if (!page) return json({ error: 'invalid_page' }, 400);

    try {
      const result = await execute(digest, page);
      if (result.status !== 'ok') {
        return result.status === 'unauthenticated' ? unauthorized() : json({ error: 'forbidden' }, 403);
      }
      const observations = result.observations.slice(0, page.limit);
      const last = observations.at(-1);
      const nextCursor = last && result.observations.length > page.limit
        ? Buffer.from(JSON.stringify([last.capturedAt, last.id])).toString('base64url')
        : null;
      return json({ observations, nextCursor });
    } catch {
      return json({ error: 'price_history_unavailable' }, 503);
    }
  };
}
