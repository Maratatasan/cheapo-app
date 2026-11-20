import { z } from 'zod';

import { json, readJson, unauthorized } from './api-http.ts';
import { readCredentialDigest } from './credential.ts';
import type { PricePhotoRole } from './price-photo.ts';

const pathPattern = /^\/v1\/me\/price-observations\/([^/]+)\/photos\/([^/]+)\/upload$/;
const observationId = z.uuid();
const details = z.strictObject({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteCount: z.number().int().min(1).max(32 * 1024 * 1024),
  width: z.number().int().min(1).max(16_384),
  height: z.number().int().min(1).max(16_384),
});
export const photoUploadLifetimeSeconds = 120;
export type PhotoUploadDetails = z.infer<typeof details>;
type UploadFailure = 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict';
type UploadResult =
  | { status: 'pending'; key: string }
  | { status: 'available' | UploadFailure };
export type PreparePhotoUpload = (
  digest: string, id: string, role: PricePhotoRole, photo: PhotoUploadDetails,
) => Promise<UploadResult>;
export type SignPhotoUpload = (
  key: string, photo: PhotoUploadDetails,
) => Promise<{ url: string; headers: Record<string, string> }>;

export type VerifyPhotoObject = (
  key: string, photo: PhotoUploadDetails, signal: AbortSignal,
) => Promise<'verified' | 'missing' | 'mismatch'>;
export type CompletePhotoUpload = (
  digest: string, id: string, role: PricePhotoRole,
) => Promise<{ status: 'pending' | 'available' | 'mismatch' | UploadFailure }>;

function uploadFailure(status: UploadFailure | 'mismatch') {
  if (status === 'unauthenticated') return unauthorized();
  if (status === 'forbidden') return json({ error: 'forbidden' }, 403);
  if (status === 'conflict') return json({ error: 'photo_conflict' }, 409);
  if (status === 'mismatch') return json({ error: 'photo_checksum_mismatch' }, 409);
  return json({ error: 'photo_not_found' }, 404);
}

async function hasBody(request: Request): Promise<boolean> {
  const reader = request.body?.getReader();
  if (!reader) return false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return false;
      if (value.byteLength) return true;
    }
  } finally {
    reader.releaseLock();
  }
}

export function isPricePhotoUploadPath(path: string) {
  return pathPattern.test(path);
}

export function createPricePhotoUploadHandler(
  prepare: PreparePhotoUpload, sign?: SignPhotoUpload, complete?: CompletePhotoUpload,
) {
  return async (request: Request): Promise<Response> => {
    const digest = readCredentialDigest(request.headers.get('Authorization'));
    if (!digest) return unauthorized();
    if (request.method !== 'PUT' && request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'PUT, POST' });
    }

    const url = new URL(request.url);
    const parsed = pathPattern.exec(url.pathname);
    const id = observationId.safeParse(parsed?.[1]).data;
    const role = parsed?.[2];
    if (!id || (role !== 'original' && role !== 'crop') || url.search) {
      return json({ error: 'invalid_photo_request' }, 400);
    }

    try {
      if (request.method === 'POST') {
        if (await hasBody(request)) return json({ error: 'invalid_photo_request' }, 400);
        if (!complete) return json({ error: 'photo_unavailable' }, 503);
        const result = await complete(digest, id, role);
        if (result.status === 'pending' || result.status === 'available') {
          return json({ role, availability: result.status });
        }
        return uploadFailure(result.status);
      }

      if (!sign) return json({ error: 'photo_unavailable' }, 503);
      const body = await readJson(request, 1024, 'invalid_photo_upload');
      if (body instanceof Response) return body;
      const metadata = details.safeParse(body.value);
      if (!metadata.success) return json({ error: 'invalid_photo_upload' }, 400);

      const result = await prepare(digest, id, role, metadata.data);
      if (result.status === 'available') return json({ role, availability: 'available' });
      if (result.status !== 'pending') return uploadFailure(result.status);
      const grant = await sign(result.key, metadata.data);
      return json({ role, availability: 'pending', ...grant, expiresInSeconds: photoUploadLifetimeSeconds });
    } catch {
      return json({ error: 'photo_unavailable' }, 503);
    }
  };
}
