import { z } from 'zod';

import { json, unauthorized } from './api-http.ts';
import { readCredentialDigest } from './credential.ts';

const item = /^\/v1\/me\/price-observations\/([^/]+)\/photos\/([^/]+)$/;
const resourceId = z.uuid();
export const photoReadLifetimeSeconds = 60;

export type PricePhotoRole = 'original' | 'crop';
type PricePhoto = {
  key: string;
  sha256: string;
  byteCount: string;
  width: number;
  height: number;
};
type PhotoResult =
  | { status: 'ok'; photo: PricePhoto }
  | { status: 'unauthenticated' | 'forbidden' | 'not_found' };
export type ReadPricePhoto = (digest: string, observationId: string, role: PricePhotoRole) => Promise<PhotoResult>;
export type SignPricePhoto = (key: string) => Promise<string>;

export function isPricePhotoPath(path: string): boolean {
  return item.test(path);
}

export function createPricePhotoHandler(read: ReadPricePhoto, sign?: SignPricePhoto) {
  return async (request: Request): Promise<Response> => {
    const digest = readCredentialDigest(request.headers.get('Authorization'));
    if (!digest) return unauthorized();
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });

    const url = new URL(request.url);
    const match = item.exec(url.pathname);
    const id = resourceId.safeParse(match?.[1]).data;
    const role = match?.[2];
    if (!id || (role !== 'original' && role !== 'crop') || url.search) {
      return json({ error: 'invalid_photo_request' }, 400);
    }
    if (!sign) return json({ error: 'photo_unavailable' }, 503);

    try {
      const result = await read(digest, id, role);
      if (result.status === 'unauthenticated') return unauthorized();
      if (result.status === 'forbidden') return json({ error: 'forbidden' }, 403);
      if (result.status !== 'ok') return json({ error: 'photo_not_found' }, 404);

      const { key, sha256, byteCount, width, height } = result.photo;
      return json({
        role, sha256, byteCount, width, height,
        url: await sign(key),
        expiresInSeconds: photoReadLifetimeSeconds,
      });
    } catch {
      return json({ error: 'photo_unavailable' }, 503);
    }
  };
}
