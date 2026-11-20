import { CryptoDigestAlgorithm, digest } from 'expo-crypto';

import { requestInterrupted } from './request-deadline';
import { isSignedS3ObjectUrl } from './s3-object-url';

export async function jpegSha256(bytes: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifiedJpeg(response: Response, metadata: { byteCount: number; sha256: string }, signal: AbortSignal) {
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
  if (await jpegSha256(bytes) !== metadata.sha256) throw Error('Cheapo photo checksum did not match.');
  return bytes;
}

export function privateJpegUploadGrant(reply: { url?: unknown; headers?: unknown; expiresInSeconds?: unknown }, byteCount: number) {
  if (!isSignedS3ObjectUrl(reply.url) || !reply.headers || typeof reply.headers !== 'object'
    || typeof reply.expiresInSeconds !== 'number' || !Number.isInteger(reply.expiresInSeconds)
    || reply.expiresInSeconds < 1 || reply.expiresInSeconds > 120) return;
  let signed: Headers;
  try { signed = new Headers(reply.headers as HeadersInit); }
  catch { return; }
  const checksum = signed.get('x-amz-checksum-sha256');
  if (signed.get('Content-Type') !== 'image/jpeg' || signed.get('Content-Length') !== String(byteCount)
    || signed.get('If-None-Match') !== '*' || !checksum || !/^[A-Za-z0-9+/]{43}=$/.test(checksum)) return;

  // Forward only the signed object headers. The Cheapo bearer is never used here.
  return { url: reply.url, timeoutMs: Math.min(110_000, reply.expiresInSeconds * 1_000), headers: {
    'Content-Type': 'image/jpeg', 'Content-Length': String(byteCount),
    'If-None-Match': '*', 'x-amz-checksum-sha256': checksum,
  } };
}
