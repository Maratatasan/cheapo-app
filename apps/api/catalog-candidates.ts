import { productSchema, type Product } from '@cheapo/domain';
import { reviewedPackParts } from '@cheapo/domain/package-measures';
import { z } from 'zod';

import { json, unauthorized } from './api-http.ts';
import type { CatalogProduct } from './catalog.ts';
import { readCredentialDigest } from './credential.ts';

export const catalogCandidatesPath = '/v1/product-candidates';
export const catalogCandidateLimit = 8;

type Identity = Pick<Product, 'name' | 'brand' | 'variety' | 'productType' | 'pack'>;
export type CatalogCandidate =
  | { kind: 'catalog'; product: CatalogProduct }
  | { kind: 'unlinked_observation'; observationId: string; details: Identity & { packSize?: string } };
export type CandidateSearch = { name: string; brand?: string; variety?: string; pack?: NonNullable<Product['pack']> };
type CandidateResult =
  | { status: 'ok'; candidates: CatalogCandidate[]; truncated: boolean }
  | { status: 'unauthenticated' | 'forbidden' };
export type ExecuteCatalogCandidates = (digest: string, search: CandidateSearch) => Promise<CandidateResult>;

const searchText = z.string().trim().min(1).max(200)
  .refine(value => !/\p{Cc}/u.test(value) && /[\p{L}\p{N}]/u.test(value));
const searchInput = z.strictObject({
  name: searchText,
  brand: searchText.optional(),
  variety: searchText.optional(),
  packSize: z.string().trim().min(1).max(50).optional(),
});

export function packFromLabel(label: string): Product['pack'] {
  const parts = reviewedPackParts(label);
  if (!parts) return undefined;
  return productSchema.shape.pack.safeParse({
    quantity: Number(parts.quantity) * parts.count,
    unit: parts.unit,
    label,
  }).data;
}

export function createCatalogCandidatesHandler(execute: ExecuteCatalogCandidates) {
  return async (request: Request): Promise<Response> => {
    const digest = readCredentialDigest(request.headers.get('Authorization'));
    if (!digest) return unauthorized();
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    const params = new URL(request.url).searchParams;
    const parsed = searchInput.safeParse(Object.fromEntries(params));
    if (!parsed.success || params.size !== new Set(params.keys()).size) {
      return json({ error: 'invalid_product_search' }, 400);
    }
    const { packSize, ...identity } = parsed.data;
    const pack = packSize ? packFromLabel(packSize) : undefined;
    if (packSize && !pack) return json({ error: 'invalid_product_search' }, 400);
    try {
      const result = await execute(digest, { ...identity, pack });
      switch (result.status) {
        case 'ok': return json({ candidates: result.candidates, truncated: result.truncated });
        case 'unauthenticated': return unauthorized();
        case 'forbidden': return json({ error: 'forbidden' }, 403);
      }
    } catch {
      return json({ error: 'catalog_unavailable' }, 503);
    }
  };
}
