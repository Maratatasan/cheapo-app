import { productSchema, type Product } from '@cheapo/domain';
import { canonicalProductBarcode } from '@cheapo/domain/product-barcode';

import { json, readJson, unauthorized } from './api-http.ts';
import { readCredentialDigest } from './credential.ts';

export type CatalogProduct = Omit<Product, 'photoIds'>;
export type CatalogAction =
  | { kind: 'find'; key: 'barcode' | 'id'; value: string }
  | { kind: 'create'; product: CatalogProduct };
export type CatalogResult =
  | { status: 'ok'; product: CatalogProduct | null }
  | { status: 'conflict'; product: CatalogProduct }
  | { status: 'unauthenticated' | 'forbidden' };
export type ExecuteCatalog = (digest: string, action: CatalogAction) => Promise<CatalogResult>;

const collection = '/v1/products';
const item = /^\/v1\/products\/([^/]+)$/;
const idInput = productSchema.shape.id.refine(id => !id.includes('\0'));

export function isCatalogPath(path: string): boolean {
  return path === collection || item.test(path);
}

function invalid() {
  return json({ error: 'invalid_product' }, 400);
}

function readId(encoded: string): string | undefined {
  try {
    return idInput.safeParse(decodeURIComponent(encoded)).data;
  } catch {
    return undefined;
  }
}

async function readAction(request: Request, url: URL): Promise<CatalogAction | Response> {
  if (url.pathname === collection) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    const values = url.searchParams.getAll('gtin');
    const barcode = values.length === 1 && canonicalProductBarcode(values[0]);
    return barcode ? { kind: 'find', key: 'barcode', value: barcode } : invalid();
  }
  const pathId = item.exec(url.pathname)?.[1];
  if (!pathId) return json({ error: 'not_found' }, 404);
  const id = readId(pathId);
  if (!id) return invalid();
  if (request.method === 'GET') return { kind: 'find', key: 'id', value: id };
  if (request.method !== 'PUT') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, PUT' });
  const body = await readJson(request, 8_192, 'invalid_product');
  if (body instanceof Response) return body;
  const value = body.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const code = 'barcode' in value ? value.barcode : undefined;
  const barcode = typeof code === 'string' ? canonicalProductBarcode(code) : undefined;
  if (code !== undefined && !barcode) return invalid();
  const product = productSchema.safeParse({ ...value, id, barcode });
  if (!product.success || (barcode && !product.data.productType)) return invalid();
  const { photoIds: _privateSource, ...fields } = product.data;
  return { kind: 'create', product: fields };
}

export function createCatalogHandler(execute: ExecuteCatalog) {
  return async (request: Request): Promise<Response> => {
    const digest = readCredentialDigest(request.headers.get('Authorization'));
    if (!digest) return unauthorized();
    const action = await readAction(request, new URL(request.url));
    if (action instanceof Response) return action;
    try {
      const result = await execute(digest, action);
      switch (result.status) {
        case 'ok': return json({ product: result.product });
        case 'conflict': return json({ error: 'product_conflict', product: result.product }, 409);
        case 'unauthenticated': return unauthorized();
        case 'forbidden': return json({ error: 'forbidden' }, 403);
      }
    } catch {
      return json({ error: 'catalog_unavailable' }, 503);
    }
  };
}
