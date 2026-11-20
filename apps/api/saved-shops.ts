import { shopSchema, type Shop } from '@cheapo/domain';
import { z } from 'zod';

import { json, readJson, unauthorized } from './api-http.ts';
import { readCredentialDigest } from './credential.ts';

export type ShopCandidate = Pick<Shop, 'id' | 'name' | 'address' | 'location'>;
type SavedShop = Shop & { testShop?: boolean };
export type SavedShopState = { shops: SavedShop[]; currentShop?: SavedShop };
export type VersionedSavedShop = { shop: SavedShop; version: string };
export type ShopAction =
  | { kind: 'read' }
  | { kind: 'candidates'; query: string }
  | { kind: 'save'; shop: Shop; select: boolean }
  | { kind: 'detail'; shopId: string }
  | { kind: 'edit'; shopId: string; details: z.infer<typeof editInput>; operation?: {
      operationId: string; expectedVersion: string;
    } }
  | { kind: 'select' | 'unlink'; shopId: string };
export type SavedShopResult =
  | { status: 'ok'; state: SavedShopState }
  | { status: 'candidates'; shops: ShopCandidate[] }
  | { status: 'detail'; detail: VersionedSavedShop }
  | { status: 'version_conflict'; current: VersionedSavedShop }
  | { status: 'unauthenticated' | 'forbidden' | 'shop_not_saved' | 'invalid_shop' | 'operation_conflict' };
export type ExecuteSavedShop = (digest: string, action: ShopAction) => Promise<SavedShopResult>;

const collection = '/v1/me/saved-shops';
const catalog = '/v1/shops';
const selection = '/v1/me/current-shop';
const item = /^\/v1\/me\/saved-shops\/([^/]+)$/;
const scalarInput = shopSchema.shape.id.refine(id => !id.includes('\0'));
const selectInput = z.object({ shopId: scalarInput });
const editInput = z.strictObject({
  name: shopSchema.shape.name.nullable(),
  nickname: shopSchema.shape.nickname.nullable(),
  address: shopSchema.shape.address.nullable(),
}).refine(details => Object.keys(details).length > 0);
const conditionalEdit = z.strictObject({
  operationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  expectedVersion: z.string().regex(/^[1-9][0-9]{0,9}:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/),
  details: editInput,
});
const queryInput = z.string().trim().min(2).max(120).refine(value => !value.includes('\0'));
const saveOptions = z.object({ select: z.boolean().default(false) });

export function isSavedShopPath(path: string): boolean {
  return path === collection || path === selection || path === catalog || item.test(path);
}

function decodedId(value: string): string | undefined {
  try {
    return scalarInput.safeParse(decodeURIComponent(value)).data;
  } catch {
    return undefined;
  }
}

function unsupported(allow: string) {
  return json({ error: 'method_not_allowed' }, 405, { Allow: allow });
}

async function readAction(request: Request, url: URL): Promise<ShopAction | Response> {
  const path = url.pathname;
  const method = request.method;
  if (path === catalog) {
    if (method !== 'GET') return unsupported('GET');
    const values = url.searchParams.getAll('query');
    const query = values.length === 1 && queryInput.safeParse(values[0]).data;
    return query ? { kind: 'candidates', query } : json({ error: 'invalid_shop_query' }, 400);
  }
  if (path === collection) return method === 'GET' ? { kind: 'read' } : unsupported('GET');
  if (path === selection && method !== 'PUT') return unsupported('PUT');
  const match = item.exec(path);
  const shopId = match && decodedId(match[1]);
  if (match && !shopId) return json({ error: 'invalid_shop_id' }, 400);
  if (shopId && method === 'GET') return { kind: 'detail', shopId };
  if (shopId && method === 'DELETE') return { kind: 'unlink', shopId };
  if (shopId && method !== 'PUT' && method !== 'PATCH') return unsupported('GET, PUT, PATCH, DELETE');
  if (!shopId && path !== selection) return json({ error: 'not_found' }, 404);

  const body = await readJson(request, 8_192, 'invalid_shop');
  if (body instanceof Response) return body;
  const value = body.value;
  if (path === selection) {
    const result = selectInput.safeParse(value);
    return result.success ? { kind: 'select', shopId: result.data.shopId } : json({ error: 'invalid_shop' }, 400);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ error: 'invalid_shop' }, 400);
  if (shopId && method === 'PATCH') {
    if ('operationId' in value || 'expectedVersion' in value || 'details' in value) {
      const result = conditionalEdit.safeParse(value);
      if (!result.success) return json({ error: 'invalid_shop' }, 400);
      const { details, ...operation } = result.data;
      return { kind: 'edit', shopId, details, operation };
    }
    const result = editInput.safeParse(value);
    return result.success ? { kind: 'edit', shopId, details: result.data } : json({ error: 'invalid_shop' }, 400);
  }
  const shop = shopSchema.safeParse({ ...value, id: shopId });
  const options = saveOptions.safeParse(value);
  if (!shop.success || !options.success) return json({ error: 'invalid_shop' }, 400);
  return { kind: 'save', shop: shop.data, select: options.data.select };
}

export function createSavedShopHandler(execute: ExecuteSavedShop) {
  return async (request: Request): Promise<Response> => {
    const digest = readCredentialDigest(request.headers.get('Authorization'));
    if (!digest) return unauthorized();
    const action = await readAction(request, new URL(request.url));
    if (action instanceof Response) return action;
    try {
      const result = await execute(digest, action);
      switch (result.status) {
        case 'ok': return json(result.state);
        case 'candidates': return json({ shops: result.shops });
        case 'detail': return json(result.detail, 200, { ETag: `"${result.detail.version}"` });
        case 'version_conflict': return json({ error: 'version_conflict',
          currentVersion: result.current.version, current: result.current.shop }, 409);
        case 'operation_conflict': return json({ error: 'operation_conflict' }, 409);
        case 'unauthenticated': return unauthorized();
        case 'forbidden': return json({ error: 'forbidden' }, 403);
        case 'shop_not_saved': return json({ error: 'shop_not_saved' }, 404);
        case 'invalid_shop': return json({ error: 'invalid_shop' }, 400);
      }
    } catch {
      return json({ error: 'saved_shops_unavailable' }, 503);
    }
  };
}
