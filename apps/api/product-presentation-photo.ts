import { productSchema } from '@cheapo/domain';
import { z } from 'zod';

import { json, readJson, unauthorized } from './api-http.ts';
import { readCredentialDigest } from './credential.ts';
import { photoReadLifetimeSeconds, type SignPricePhoto } from './price-photo.ts';
import { photoUploadLifetimeSeconds, type SignPhotoUpload } from './price-photo-upload.ts';
import type { ProductPresentationPhotos } from './postgres-product-presentation-photo.ts';

const pathPattern = /^\/v1\/products\/([^/]+)\/presentation-photo(\/upload)?$/;
const productId = productSchema.shape.id.refine(value => !value.includes('\0'));
const operationId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const confirmInput = z.strictObject({ operationId });
const prepareInput = confirmInput.extend({
  expectedVersion: z.number().int().min(0).max(2_147_483_646),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteCount: z.number().int().min(1).max(8 * 1024 * 1024),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
});

const unavailable = () => json({ error: 'photo_unavailable' }, 503);
const invalid = () => json({ error: 'invalid_photo_request' }, 400);
const notFound = () => json({ error: 'photo_not_found' }, 404);

export function isProductPresentationPhotoPath(path: string) {
  return pathPattern.test(path);
}

function readId(encoded: string) {
  try {
    return productId.safeParse(decodeURIComponent(encoded)).data;
  } catch {
    return undefined;
  }
}

function failure(status: 'unauthenticated' | 'forbidden' | 'not_found' | 'operation_conflict' | 'mismatch') {
  if (status === 'unauthenticated') return unauthorized();
  if (status === 'forbidden') return json({ error: 'forbidden' }, 403);
  if (status === 'operation_conflict') return json({ error: 'operation_conflict' }, 409);
  if (status === 'mismatch') return json({ error: 'photo_checksum_mismatch' }, 409);
  return notFound();
}

export function createProductPresentationPhotoHandler(
  repository: ProductPresentationPhotos | undefined, signRead?: SignPricePhoto, signUpload?: SignPhotoUpload,
) {
  return async (request: Request): Promise<Response> => {
    const digest = readCredentialDigest(request.headers.get('Authorization'));
    if (!digest) return unauthorized();
    const url = new URL(request.url);
    const path = pathPattern.exec(url.pathname);
    if (!path) return notFound();
    const id = readId(path[1]);
    if (!id || url.searchParams.size) return invalid();
    const upload = Boolean(path[2]);
    const method = request.method;
    if (upload ? method !== 'PUT' && method !== 'POST' : method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405, { Allow: upload ? 'PUT, POST' : 'GET' });
    }
    if (!repository) return unavailable();

    try {
      if (!upload) {
        if (!signRead) return unavailable();
        const result = await repository.read(digest, id);
        if (result.status !== 'available') return failure(result.status);
        const { key, version, sha256, byteCount, width, height } = result.photo;
        return json({ version, sha256, byteCount, width, height,
          url: await signRead(key), expiresInSeconds: photoReadLifetimeSeconds });
      }
      const body = await readJson(request, 1024, 'invalid_photo_request');
      if (body instanceof Response) return body;
      if (method === 'PUT') {
        if (!signUpload) return unavailable();
        const plan = prepareInput.safeParse(body.value).data;
        if (!plan) return invalid();
        const result = await repository.prepare(digest, id, plan);
        if (result.status === 'pending') {
          const { sha256, byteCount, width, height } = plan;
          const { url, headers } = await signUpload(result.key, { sha256, byteCount, width, height });
          return json({ availability: 'pending', url, headers, expiresInSeconds: photoUploadLifetimeSeconds });
        }
        if (result.status === 'available') return json({ availability: 'available', version: result.version });
        if (result.status === 'version_conflict') return json({ error: 'photo_version_conflict', currentVersion: result.currentVersion }, 409);
        return failure(result.status);
      }
      const intent = confirmInput.safeParse(body.value).data;
      if (!intent) return invalid();
      const result = await repository.confirm(digest, id, intent.operationId);
      if (result.status === 'pending') return json({ availability: 'pending' });
      if (result.status === 'available') return json({ availability: 'available', version: result.version });
      if (result.status === 'version_conflict') return json({ error: 'photo_version_conflict', currentVersion: result.currentVersion }, 409);
      return failure(result.status);
    } catch {
      return unavailable();
    }
  };
}
