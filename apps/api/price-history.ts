import { z } from 'zod';

import { json, unauthorized } from './api-http.ts';
import { readCredentialDigest } from './credential.ts';
import { appendPriceObservation, type ExecutePriceAppend } from './price-append.ts';

const collection = '/v1/me/price-observations';
const item = /^\/v1\/me\/price-observations\/([^/]+)$/;
const cursorFields = z.tuple([z.iso.datetime({ precision: 6 }), z.uuid()]);
const defaultLimit = 30;
const maxLimit = 50;
const queryKeys = new Set(['limit', 'cursor', 'productId', 'comparableGroupId', 'productType', 'currency']);
const filterId = z.string().regex(/^[^\s\0]{1,128}$/);
const historyFilters = z.object({
  productId: filterId.nullable(),
  comparableGroupId: filterId.nullable(),
  productType: z.string().trim().min(1).max(120).refine(value => !value.includes('\0')).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
});

type PriceCursor = z.infer<typeof cursorFields>;
type PriceHistoryPage = {
  kind: 'page'; limit: number; cursor?: PriceCursor;
  filters: z.infer<typeof historyFilters>;
};
type PriceHistoryRead = PriceHistoryPage | { kind: 'detail'; id: string };
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
  photos: { role: 'original' | 'crop'; width: number; height: number; availability?: 'pending' }[];
};
type PriceCropBox = { left: number; top: number; right: number; bottom: number };
export type PriceObservationDetail = PriceObservation & {
  cropBox: PriceCropBox | null;
  selectedPhotoRole: 'original' | 'crop' | null;
};
type PriceHistoryResult =
  | { status: 'ok'; observations: PriceObservation[] }
  | { status: 'detail'; observation: PriceObservationDetail }
  | { status: 'unauthenticated' | 'forbidden' | 'not_found' };
export type ExecutePriceHistory = (digest: string, read: PriceHistoryRead) => Promise<PriceHistoryResult>;

export function isPriceHistoryPath(path: string): boolean {
  return path === collection || item.test(path);
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
  if (new Set(keys).size !== keys.length || keys.some(key => !queryKeys.has(key))) {
    return undefined;
  }
  const size = params.get('limit');
  if (size !== null && !/^[1-9]\d?$/.test(size)) return undefined;
  const limit = size === null ? defaultLimit : Number(size);
  if (limit > maxLimit) return undefined;
  const value = params.get('cursor');
  const cursor = value === null ? undefined : readCursor(value);
  if (value !== null && !cursor) return undefined;
  const filters = historyFilters.safeParse({
    productId: params.get('productId'),
    comparableGroupId: params.get('comparableGroupId'),
    productType: params.get('productType'),
    currency: params.get('currency'),
  }).data;
  if (!filters || (filters.productId && (filters.comparableGroupId || filters.productType))) return undefined;
  return { kind: 'page', limit, cursor, filters };
}

export function createPriceHistoryHandler(execute: ExecutePriceHistory, append: ExecutePriceAppend) {
  return async (request: Request): Promise<Response> => {
    const digest = readCredentialDigest(request.headers.get('Authorization'));
    if (!digest) return unauthorized();
    const url = new URL(request.url);
    const matched = item.exec(url.pathname);
    if (!matched && request.method === 'POST') return appendPriceObservation(request, digest, append);
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: matched ? 'GET' : 'GET, POST' });

    const id = matched && z.uuid().safeParse(matched[1]).data;
    if (matched && !id) return json({ error: 'invalid_observation_id' }, 400);
    if (matched && url.searchParams.size) return json({ error: 'invalid_page' }, 400);
    const read: PriceHistoryRead | undefined = id ? { kind: 'detail', id } : readPage(url.searchParams);
    if (!read) return json({ error: 'invalid_page' }, 400);

    try {
      const result = await execute(digest, read);
      if (result.status === 'unauthenticated') return unauthorized();
      if (result.status === 'forbidden') return json({ error: 'forbidden' }, 403);
      if (result.status === 'not_found') return json({ error: 'observation_not_found' }, 404);
      if (result.status === 'detail') return json({ observation: result.observation });
      if (result.status !== 'ok' || read.kind !== 'page') return json({ error: 'price_history_unavailable' }, 503);
      const observations = result.observations.slice(0, read.limit);
      const last = observations.at(-1);
      const nextCursor = last && result.observations.length > read.limit
        ? Buffer.from(JSON.stringify([last.capturedAt, last.id])).toString('base64url')
        : null;
      return json({ observations, nextCursor });
    } catch {
      return json({ error: 'price_history_unavailable' }, 503);
    }
  };
}
