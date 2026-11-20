import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { fetch } from 'expo/fetch';

import { CheapoAccessError, type CheapoAccess, type CheapoReadSession } from '../lib/cheapo-access/client';
import { jpegSha256, privateJpegUploadGrant, verifiedJpeg } from '../lib/cheapo-access/photo-objects';
import { requestInterrupted, withCheapoDeadline } from '../lib/cheapo-access/request-deadline';
import { isSignedS3ObjectUrl } from '../lib/cheapo-access/s3-object-url';
import { readPricePhotoMetadata, type CachedPricePhoto, type PricePhotoCache, type PricePhotoMetadata } from './cheapo-price-photo-read';
import { productPath } from './cheapo-shopping-reads';
import type { PhotoAsset } from './local-photo';
import { sameShoppingOwner, type PriceQueueOwner } from './price-append-queue';

type WriteSession = Awaited<ReturnType<CheapoAccess['openShoppingWriteSession']>>;
type ObjectFetch = (url: string, init: RequestInit) => Promise<Response>;
type PresentationPhoto = CachedPricePhoto & { version: number };
type ReadResult = { status: 'fresh' | 'cached'; photo: PresentationPhoto } | { status: 'missing' | 'unavailable' };
type SaveResult = { status: 'available'; version: number } | { status: 'conflict'; currentVersion: number }
  | { status: 'retry' | 'blocked' };
export type PreparedProductPhoto = Readonly<{
  productId: string; operationId: string; expectedVersion: number;
  sha256: string; byteCount: number; width: number; height: number;
}>;

const maxFileBytes = 8 * 1024 * 1024;
const maxPhotoSide = 4096;
const maxVersion = 2_147_483_647;
const apiDeadlineMs = 35_000;

function integerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function presentationPath(id: string) { return `${productPath(id)}/presentation-photo`; }
function cacheKey(session: CheapoReadSession, path: string) { return `${session.cacheScope}\0${path}`; }

function isPresentationObject(value: unknown): value is string {
  return isSignedS3ObjectUrl(value)
    && /\/product-presentation\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.jpg$/.test(new URL(value).pathname);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseReadGrant(body: Record<string, unknown> | undefined) {
  if (!body || !isPresentationObject(body.url) || !integerInRange(body.expiresInSeconds, 1, 60)
    || !integerInRange(body.byteCount, 1, maxFileBytes) || !integerInRange(body.width, 1, maxPhotoSide)
    || !integerInRange(body.height, 1, maxPhotoSide) || !integerInRange(body.version, 1, maxVersion)) return;
  const metadata = readPricePhotoMetadata({ ...body, lastSyncedAt: new Date().toISOString() });
  if (!metadata) return;
  return { url: body.url, expiresInSeconds: body.expiresInSeconds, metadata: { ...metadata, version: body.version } };
}

function cachedPhoto(value: CachedPricePhoto | null): PresentationPhoto | undefined {
  if (value?.version !== undefined) return { ...value, version: value.version };
}

function sameAsset(saved: CachedPricePhoto, expected: PricePhotoMetadata) {
  return saved.sha256 === expected.sha256 && saved.byteCount === expected.byteCount
    && saved.width === expected.width && saved.height === expected.height;
}

function saveReply(status: number, body: Record<string, unknown> | undefined, expectedVersion: number): SaveResult {
  if (status >= 200 && status < 300 && body?.availability === 'available' && body.version === expectedVersion + 1) {
    return { status: 'available', version: body.version };
  }
  if (status === 409 && body?.error === 'photo_version_conflict' && integerInRange(body.currentVersion, 0, maxVersion)) {
    return { status: 'conflict', currentVersion: body.currentVersion };
  }
  return { status: status === 408 || status === 429 || status >= 500 || body?.availability === 'pending' ? 'retry' : 'blocked' };
}

export function createProductPresentationPhotos({ owner, openRead, openWrite, cache, objectFetch = fetch }: {
  owner: PriceQueueOwner;
  openRead: () => Promise<CheapoReadSession>;
  openWrite: () => Promise<WriteSession>;
  cache: PricePhotoCache;
  objectFetch?: ObjectFetch;
}) {
  // Retain the exact checked bytes for retry within this editor session.
  const preparedBytes = new WeakMap<PreparedProductPhoto, Uint8Array<ArrayBuffer>>();

  async function read(productId: string, signal?: AbortSignal, mode?: 'cache-only'): Promise<ReadResult> {
    const path = presentationPath(productId);
    const revision = cache.revision();
    const session = await openRead();
    const key = cacheKey(session, path);
    const current = () => {
      if (signal?.aborted || revision !== cache.revision()) throw requestInterrupted();
      session.assertCurrent();
    };
    async function readSaved() {
      const saved = cachedPhoto(await cache.read(key, revision).catch(() => null));
      current();
      return saved;
    }
    async function fallback(): Promise<ReadResult> {
      const photo = await readSaved();
      return photo ? { status: 'cached', photo } : { status: 'unavailable' };
    }
    if (mode === 'cache-only') return fallback();

    try {
      const before = await readSaved();
      const { status, body } = await withCheapoDeadline(signal, apiDeadlineMs, async stageSignal => {
        current();
        const response = await session.get(path, stageSignal);
        return { status: response.status, body: response.ok || response.status === 404 ? record(await response.json()) : undefined };
      });
      current();
      if (status === 401 || status === 403) throw new CheapoAccessError('Cheapo access ended.');
      if (status === 404 && body?.error === 'photo_not_found') {
        await cache.remove(key, revision, before?.version ?? 0).catch(() => {});
        const latest = await readSaved();
        if (latest && latest.version > (before?.version ?? 0)) return { status: 'cached', photo: latest };
        return { status: 'missing' };
      }
      if (status < 200 || status >= 300) return fallback();
      const grant = parseReadGrant(body);
      if (!grant) return fallback();
      const saved = await readSaved();
      if (saved && saved.version >= grant.metadata.version) {
        return { status: saved.version === grant.metadata.version && sameAsset(saved, grant.metadata) ? 'fresh' : 'cached', photo: saved };
      }
      const bytes = await withCheapoDeadline(signal, Math.min(55_000, grant.expiresInSeconds * 1_000), async stageSignal => {
        current();
        const response = await objectFetch(grant.url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: stageSignal });
        return verifiedJpeg(response, grant.metadata, stageSignal);
      });
      current();
      const photo = cachedPhoto(await cache.write(key, revision, grant.metadata, bytes));
      current();
      return photo ? { status: 'fresh', photo } : fallback();
    } catch (error) {
      if (error instanceof CheapoAccessError) throw error;
      current();
      return fallback();
    }
  }

  async function prepare(productId: string, expectedVersion: number, asset: PhotoAsset, signal?: AbortSignal) {
    presentationPath(productId);
    if (!integerInRange(expectedVersion, 0, maxVersion - 1)) throw Error('Check the current product photo before replacing it.');
    const invalid = () => Error('Choose a JPEG up to 8 MiB and 4096 pixels per side.');
    if (asset.mimeType !== 'image/jpeg' || !asset.uri.startsWith('file:///')
      || !integerInRange(asset.width, 1, maxPhotoSide) || !integerInRange(asset.height, 1, maxPhotoSide)) throw invalid();
    const bytes = await withCheapoDeadline(signal, 10_000, async stageSignal => {
      const file = new File(asset.uri);
      if (!file.exists || !integerInRange(file.size, 4, maxFileBytes)) throw invalid();
      const value = await file.bytes();
      if (stageSignal.aborted) throw requestInterrupted();
      if (!integerInRange(value.byteLength, 4, maxFileBytes) || value[0] !== 255 || value[1] !== 216) throw invalid();
      return value;
    });
    const sha256 = await jpegSha256(bytes);
    if (signal?.aborted) throw requestInterrupted();
    const plan: PreparedProductPhoto = Object.freeze({ productId, operationId: randomUUID(), expectedVersion, sha256,
      byteCount: bytes.byteLength, width: asset.width, height: asset.height });
    preparedBytes.set(plan, bytes);
    return plan;
  }

  async function replace(plan: PreparedProductPhoto, signal?: AbortSignal): Promise<SaveResult> {
    const bytes = preparedBytes.get(plan);
    if (!bytes) return { status: 'blocked' };
    const { productId, operationId, expectedVersion, sha256, byteCount, width, height } = plan;
    const path = presentationPath(productId);
    const revision = cache.revision();
    try {
      if (signal?.aborted) throw requestInterrupted();
      const session = await openWrite();
      if (!sameShoppingOwner(session.owner, owner)) throw new CheapoAccessError('Cheapo access changed. Try again.');
      const request = (method: 'PUT' | 'POST', data: object) => withCheapoDeadline(signal, apiDeadlineMs, async stageSignal => {
        session.assertCurrent();
        const response = await session.request(`${path}/upload`, { method, body: JSON.stringify(data),
          headers: { 'Content-Type': 'application/json' }, signal: stageSignal });
        const body = response.ok || response.status === 409 ? record(await response.json()) : undefined;
        session.assertCurrent();
        return { status: response.status, body };
      });
      const prepared = await request('PUT', { operationId, expectedVersion, sha256, byteCount, width, height });
      let outcome = saveReply(prepared.status, prepared.body, expectedVersion);
      if (prepared.status === 200 && prepared.body?.availability === 'pending') {
        const grant = privateJpegUploadGrant(prepared.body, byteCount);
        if (!grant || !isPresentationObject(grant.url)) return { status: 'blocked' };
        const uploaded = await withCheapoDeadline(signal, grant.timeoutMs, stageSignal => {
          session.assertCurrent();
          return objectFetch(grant.url, { method: 'PUT', headers: grant.headers, body: bytes,
            redirect: 'error', credentials: 'omit', signal: stageSignal });
        });
        // A conditional conflict can mean a prior attempt already stored the bytes.
        if (!uploaded.ok && uploaded.status !== 409 && uploaded.status !== 412) return { status: 'retry' };
        const confirmed = await request('POST', { operationId });
        outcome = saveReply(confirmed.status, confirmed.body, expectedVersion);
      }
      if (outcome.status === 'available') {
        session.assertCurrent();
        const version = outcome.version;
        if (!signal?.aborted && revision === cache.revision()) {
          await openRead().then(reader => {
            session.assertCurrent();
            reader.assertCurrent();
            if (signal?.aborted || revision !== cache.revision()) return;
            return cache.write(cacheKey(reader, path), revision, { sha256, byteCount, width, height, version,
              lastSyncedAt: new Date().toISOString() }, bytes);
          }).catch(() => {});
        }
        session.assertCurrent();
      }
      return outcome;
    } catch (error) {
      if (error instanceof CheapoAccessError) throw error;
      return { status: 'retry' };
    }
  }

  return { read, prepare, replace };
}
