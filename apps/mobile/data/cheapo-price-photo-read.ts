import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { fetch } from 'expo/fetch';

import { CheapoAccessError, type CheapoReadSession } from '../lib/cheapo-access/client';
import { requestInterrupted, withCheapoDeadline } from '../lib/cheapo-access/request-deadline';
import { isSignedS3ObjectUrl } from '../lib/cheapo-access/s3-object-url';
import { historyObservationPath } from './cheapo-price-history';
import type { ShoppingRead } from './cheapo-shopping-reads';

export type PriceEvidenceRole = 'original' | 'crop';
export type PricePhotoMetadata = { sha256: string; byteCount: number; width: number; height: number; lastSyncedAt: string };
export type CachedPricePhoto = PricePhotoMetadata & { uri: string };
export type PricePhotoCache = {
  revision(): number;
  read(key: string, revision: number): Promise<CachedPricePhoto | null>;
  write(key: string, revision: number, metadata: PricePhotoMetadata, bytes: Uint8Array<ArrayBuffer>): Promise<CachedPricePhoto | null>;
  remove(key: string, revision: number): Promise<void>;
};
type ObjectFetch = (url: string, init: RequestInit) => Promise<Response>;

const maxPhotoBytes = 32 * 1024 * 1024;

export function readPricePhotoMetadata(value: unknown): PricePhotoMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const { sha256, byteCount, width, height, lastSyncedAt } = value as Partial<PricePhotoMetadata>;
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)
    || typeof byteCount !== 'number' || !Number.isSafeInteger(byteCount) || byteCount < 1 || byteCount > maxPhotoBytes
    || typeof width !== 'number' || !Number.isSafeInteger(width) || width < 1
    || typeof height !== 'number' || !Number.isSafeInteger(height) || height < 1
    || typeof lastSyncedAt !== 'string' || !Number.isFinite(Date.parse(lastSyncedAt))) return null;
  return { sha256, byteCount, width, height, lastSyncedAt };
}

function readGrant(value: unknown, role: PriceEvidenceRole) {
  if (!value || typeof value !== 'object') throw Error('Unreadable Cheapo photo grant.');
  const grant = value as Record<string, unknown>;
  const metadata = typeof grant.byteCount === 'string' && /^\d{1,8}$/.test(grant.byteCount) && readPricePhotoMetadata({
    sha256: grant.sha256, byteCount: Number(grant.byteCount), width: grant.width, height: grant.height,
    lastSyncedAt: new Date().toISOString(),
  });
  if (grant.role !== role || !metadata || !isSignedS3ObjectUrl(grant.url)
    || typeof grant.expiresInSeconds !== 'number' || !Number.isInteger(grant.expiresInSeconds)
    || grant.expiresInSeconds < 1 || grant.expiresInSeconds > 60) throw Error('Unreadable Cheapo photo grant.');
  return { url: grant.url, expiresInSeconds: grant.expiresInSeconds, metadata };
}

async function verifiedJpeg(response: Response, metadata: PricePhotoMetadata, signal: AbortSignal) {
  if (!response.ok || response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg'
    || response.headers.get('Content-Length') !== String(metadata.byteCount) || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw Error('Cheapo photo could not be read.');
  }
  const bytes = new Uint8Array(metadata.byteCount);
  const reader = response.body.getReader();
  let received = 0;
  let finished = false;
  try {
    while (true) {
      const next = await reader.read();
      if (signal.aborted) throw requestInterrupted();
      if (next.done) { finished = true; break; }
      if (received + next.value.byteLength > bytes.byteLength) throw Error('Cheapo photo length did not match.');
      bytes.set(next.value, received);
      received += next.value.byteLength;
    }
  } finally {
    if (!finished) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (received !== bytes.byteLength) throw Error('Cheapo photo length did not match.');
  const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes));
  if (Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') !== metadata.sha256) {
    throw Error('Cheapo photo checksum did not match.');
  }
  return bytes;
}

export function createCheapoPricePhotoRead(
  openSession: () => Promise<CheapoReadSession>, cache: PricePhotoCache, objectFetch: ObjectFetch = fetch,
) {
  return async function readPricePhoto(
    observationId: string, role: PriceEvidenceRole, signal?: AbortSignal, mode?: 'cache-only',
  ): Promise<ShoppingRead<CachedPricePhoto>> {
    if (role !== 'original' && role !== 'crop') throw Error('Invalid Cheapo photo role.');
    if (signal?.aborted) throw requestInterrupted();
    const path = `${historyObservationPath(observationId)}/photos/${role}`;
    const revision = cache.revision();
    const session = await openSession();
    const key = `${session.cacheScope}\0${path}`;
    if (revision !== cache.revision()) return { status: 'unavailable' };

    function assertCurrent() {
      if (signal?.aborted) throw requestInterrupted();
      session.assertCurrent();
    }

    async function fromCache(): Promise<ShoppingRead<CachedPricePhoto>> {
      const value = await cache.read(key, revision).catch(() => null);
      assertCurrent();
      return value && revision === cache.revision() ? { status: 'cached', value, lastSyncedAt: value.lastSyncedAt } : { status: 'unavailable' };
    }
    if (mode === 'cache-only') return fromCache();

    let checked: { ok: boolean; status: number; body: unknown };
    try {
      checked = await withCheapoDeadline(signal, 35_000, async stageSignal => {
        const response = await session.get(path, stageSignal);
        if (stageSignal.aborted) throw requestInterrupted();
        return { status: response.status, ok: response.ok, body: response.ok ? await response.json() : undefined };
      });
    } catch (error) {
      if (error instanceof CheapoAccessError || error instanceof SyntaxError || signal?.aborted) throw error;
      return fromCache();
    }
    assertCurrent();
    if (checked.status === 429 || checked.status >= 500) return fromCache();
    if (!checked.ok) {
      if (checked.status === 404) await cache.remove(key, revision);
      return { status: 'unavailable' };
    }

    const { url, expiresInSeconds, metadata } = readGrant(checked.body, role);
    const existing = await cache.read(key, revision).catch(() => null);
    assertCurrent();
    if (revision !== cache.revision()) return { status: 'unavailable' };
    if (existing && existing.sha256 === metadata.sha256 && existing.byteCount === metadata.byteCount
      && existing.width === metadata.width && existing.height === metadata.height) {
      return { status: 'fresh', value: existing, lastSyncedAt: existing.lastSyncedAt };
    }
    if (existing) await cache.remove(key, revision);
    assertCurrent();
    if (revision !== cache.revision()) return { status: 'unavailable' };

    try {
      const bytes = await withCheapoDeadline(signal, Math.min(55_000, expiresInSeconds * 1_000), async stageSignal => {
        assertCurrent();
        const response = await objectFetch(url, { method: 'GET', credentials: 'omit', redirect: 'error', signal: stageSignal });
        if (stageSignal.aborted) throw requestInterrupted();
        return verifiedJpeg(response, metadata, stageSignal);
      });
      assertCurrent();
      const value = await cache.write(key, revision, { ...metadata, lastSyncedAt: new Date().toISOString() }, bytes);
      assertCurrent();
      return value && revision === cache.revision() ? { status: 'fresh', value, lastSyncedAt: value.lastSyncedAt } : { status: 'unavailable' };
    } catch (error) {
      if (error instanceof CheapoAccessError || signal?.aborted) throw error;
      return { status: 'unavailable' };
    }
  };
}
