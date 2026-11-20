import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { File } from 'expo-file-system';
import { fetch } from 'expo/fetch';

import { CheapoAccessError } from '../lib/cheapo-access/client';
import { withCheapoDeadline } from '../lib/cheapo-access/request-deadline';
import { isSignedS3ObjectUrl } from '../lib/cheapo-access/s3-object-url';
import { savedPhotoDirectory, type LocalPhotoDraft, type PhotoAsset, type SavedPriceRecord } from './local-photo';
import type { PriceAppendReceipt } from './price-append-queue';

const maxPhotoBytes = 32 * 1024 * 1024;
const maxPhotoDimension = 16_384;
const apiDeadlineMs = 35_000;
const fileDeadlineMs = 10_000;
const putDeadlineMs = 110_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const localId = /^[A-Za-z0-9_-]{1,128}$/;
const sha256 = /^[a-f0-9]{64}$/;

type PhotoRole = 'original' | 'crop';
type PhotoSource = { sourceId: string; role: PhotoRole; uri: string; width: number; height: number };
export type PricePhotoIntent = PhotoSource & { observationId: string; sha256: string; byteCount: number };
type TransferResult = 'available' | 'retry' | 'blocked' | 'local-photo-unavailable';
type TransferSession = {
  assertCurrent(): void;
  request(path: string, init: RequestInit): Promise<Response>;
};
type ObjectFetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>;

function positiveInt(value: number, max: number) {
  return Number.isInteger(value) && value > 0 && value <= max;
}

async function readPhoto(source: PhotoSource) {
  const { sourceId, role, uri } = source;
  if (!localId.test(sourceId) || (role !== 'original' && role !== 'crop') || typeof uri !== 'string'
    || !positiveInt(source.width, maxPhotoDimension) || !positiveInt(source.height, maxPhotoDimension)) {
    throw Error('The saved photo is unavailable.');
  }
  const name = uri.split('/').pop() ?? '';
  const prefix = `${sourceId}-selected-`;
  const matchesName = role === 'original' ? name === `${sourceId}-original.jpg`
    : name.startsWith(prefix) && /^\d+\.jpg$/.test(name.slice(prefix.length));
  if (!matchesName) throw Error('The saved photo is unavailable.');
  const file = new File(savedPhotoDirectory(), name);
  if (file.uri !== uri || !file.exists || !positiveInt(file.size, maxPhotoBytes)) throw Error('The saved photo is unavailable.');
  const bytes = await file.bytes();
  if (!positiveInt(bytes.byteLength, maxPhotoBytes)) throw Error('The saved photo is unavailable.');
  const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes));
  return { bytes, sha256: Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('') };
}

export function plannedPriceEvidenceRoles(record: LocalPhotoDraft, receipt: Pick<PriceAppendReceipt, 'deriveCropFromOriginal'>): PhotoRole[] {
  return !receipt.deriveCropFromOriginal && record.original.uri !== record.selected.uri ? ['original', 'crop'] : ['original'];
}

export async function describePriceEvidence(
  record: SavedPriceRecord, receipt: Pick<PriceAppendReceipt, 'id' | 'sourceId' | 'deriveCropFromOriginal'>, signal?: AbortSignal,
): Promise<PricePhotoIntent[]> {
  const { id: observationId, sourceId } = receipt;
  if (record.id !== sourceId || !localId.test(sourceId) || !uuid.test(observationId)) {
    throw Error('The saved price does not match its acknowledgement.');
  }
  if (!record.original) return [];

  function captureSource(photo: PhotoAsset, role: PhotoRole): PhotoSource {
    if (photo.mimeType !== 'image/jpeg') throw Error('The saved photo is unavailable.');
    return { sourceId, role, uri: photo.uri, width: photo.width, height: photo.height };
  }

  const sources = plannedPriceEvidenceRoles(record, receipt)
    .map(role => captureSource(role === 'original' ? record.original : record.selected, role));
  const intents: PricePhotoIntent[] = [];
  for (const source of sources) {
    const content = await withCheapoDeadline(signal, fileDeadlineMs, () => readPhoto(source))
      .catch(() => { throw Error('The saved photo is unavailable.'); });
    intents.push({ ...source, observationId, sha256: content.sha256, byteCount: content.bytes.byteLength });
  }
  return intents;
}

type PhotoReply = { role?: unknown; availability?: unknown; url?: unknown; headers?: unknown; expiresInSeconds?: unknown };

function parseGrant(reply: PhotoReply, byteCount: number) {
  if (!isSignedS3ObjectUrl(reply.url) || !reply.headers || typeof reply.headers !== 'object'
    || typeof reply.expiresInSeconds !== 'number' || !positiveInt(reply.expiresInSeconds, 120)) return;
  let signed: Headers;
  try {
    signed = new Headers(reply.headers as HeadersInit);
  } catch {
    return;
  }
  const checksum = signed.get('x-amz-checksum-sha256');
  if (signed.get('Content-Type') !== 'image/jpeg' || signed.get('Content-Length') !== String(byteCount)
    || signed.get('If-None-Match') !== '*' || !checksum || !/^[A-Za-z0-9+/]{43}=$/.test(checksum)) return;

  // Build the object request from the four required headers. The API's
  // bearer and any unrelated response headers stay outside this transport.
  return {
    url: reply.url,
    timeoutMs: Math.min(putDeadlineMs, reply.expiresInSeconds * 1_000),
    headers: {
      'Content-Type': 'image/jpeg', 'Content-Length': String(byteCount),
      'If-None-Match': '*', 'x-amz-checksum-sha256': checksum,
    },
  };
}

export async function transferPricePhoto(
  intent: PricePhotoIntent, session: TransferSession, signal?: AbortSignal, objectFetch: ObjectFetch = fetch,
): Promise<TransferResult> {
  const { observationId, role, sha256: expectedHash, byteCount, width, height } = intent;
  if (!uuid.test(observationId) || (role !== 'original' && role !== 'crop') || !sha256.test(expectedHash)
    || !positiveInt(byteCount, maxPhotoBytes) || !positiveInt(width, maxPhotoDimension) || !positiveInt(height, maxPhotoDimension)) return 'blocked';
  const path = `/v1/me/price-observations/${observationId}/photos/${role}/upload`;

  function request(init: RequestInit) {
    return withCheapoDeadline(signal, apiDeadlineMs, async stageSignal => {
      session.assertCurrent();
      const response = await session.request(path, { ...init, signal: stageSignal });
      const reply: PhotoReply | null = response.ok ? await response.json() : null;
      session.assertCurrent();
      return { status: response.status, reply };
    });
  }

  try {
    const prepared = await request({
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha256: expectedHash, byteCount, width, height }),
    });
    if (!prepared.reply) return failedApiStatus(prepared.status);
    if (prepared.reply.role !== role) return 'blocked';
    if (prepared.reply.availability === 'available') return 'available';
    const grant = prepared.reply.availability === 'pending' && parseGrant(prepared.reply, byteCount);
    if (!grant) return 'blocked';

    const photo = await withCheapoDeadline(signal, fileDeadlineMs, () => readPhoto(intent)).catch(() => null);
    if (signal?.aborted) return 'retry';
    if (!photo || photo.bytes.byteLength !== byteCount || photo.sha256 !== expectedHash) return 'local-photo-unavailable';

    const uploaded = await withCheapoDeadline(signal, grant.timeoutMs, stageSignal => {
      session.assertCurrent();
      return objectFetch(grant.url, {
        method: 'PUT', headers: grant.headers, body: photo.bytes,
        redirect: 'error', credentials: 'omit', signal: stageSignal,
      });
    });
    // A conditional conflict can mean a prior attempt already stored the bytes.
    if (!uploaded.ok && uploaded.status !== 409 && uploaded.status !== 412) return 'retry';
    const verified = await request({ method: 'POST' });
    if (!verified.reply) return failedApiStatus(verified.status);
    return verified.reply.role === role && verified.reply.availability === 'available' ? 'available' : 'retry';
  } catch (error) {
    return error instanceof CheapoAccessError ? 'blocked' : 'retry';
  }
}

function failedApiStatus(status: number): TransferResult {
  return status >= 400 && status < 500 && status !== 408 && status !== 429 ? 'blocked' : 'retry';
}
