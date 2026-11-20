import { createHash, randomBytes } from 'node:crypto';

const bearerPattern = /^Bearer (cheapo_[A-Za-z0-9_-]{43})$/i;

export function generateCredential(): string {
  return `cheapo_${randomBytes(32).toString('base64url')}`;
}

export function credentialDigest(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

export function readCredentialDigest(authorization: string | null): string | null {
  const token = bearerPattern.exec(authorization ?? '')?.[1];
  return token ? credentialDigest(token) : null;
}
