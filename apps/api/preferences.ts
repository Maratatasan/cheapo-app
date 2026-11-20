import { readCredentialDigest } from './credential.ts';

// Keep aligned with the comparison bases used for confirmed package measures.
const allowedBases = ['kg', '100g', 'litre', '100mL', 'item', 'wash'] as const;
export type ComparisonBasis = typeof allowedBases[number];
export type PreferenceOperation = 'GET' | 'PUT' | 'DELETE';
export type PreferenceResult = {
  access: 'authorized' | 'unauthenticated' | 'forbidden';
  basis: ComparisonBasis | null;
};
export type ExecutePreference = (
  tokenDigest: string,
  productGroupId: string,
  operation: PreferenceOperation,
  basis: ComparisonBasis | null,
) => Promise<PreferenceResult>;

const maxBodyBytes = 512;
const pathPattern = /^\/v1\/me\/comparison-preferences\/([^/]+)$/;

function json(body: object, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function unauthorized() {
  return json({ error: 'unauthenticated' }, 401, { 'WWW-Authenticate': 'Bearer' });
}

function decodeGroupId(encoded: string): string | null {
  try {
    const value = decodeURIComponent(encoded);
    if (value.length > 0 && value.length <= 128 && value === value.trim() && !/[\p{Cc}/]/u.test(value)) {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function readBasis(value: unknown): ComparisonBasis | undefined {
  if (!value || typeof value !== 'object' || !('basis' in value) || Object.keys(value).length !== 1) {
    return undefined;
  }
  return allowedBases.find(basis => basis === value.basis);
}

async function readBody(request: Request): Promise<ComparisonBasis | Response> {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return json({ error: 'expected_json' }, 415);

  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'invalid_basis' }, 400);
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBodyBytes) return json({ error: 'body_too_large' }, 413);
      chunks.push(chunk.value);
    }
    const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
    return readBasis(JSON.parse(body)) ?? json({ error: 'invalid_basis' }, 400);
  } catch {
    return json({ error: 'invalid_basis' }, 400);
  } finally {
    reader.releaseLock();
  }
}

export function createPreferencesHandler(execute: ExecutePreference) {
  return async (request: Request): Promise<Response> => {
    const match = pathPattern.exec(new URL(request.url).pathname);
    if (!match) return json({ error: 'not_found' }, 404);

    const operation = request.method;
    if (operation !== 'GET' && operation !== 'PUT' && operation !== 'DELETE') {
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, PUT, DELETE' });
    }

    const tokenDigest = readCredentialDigest(request.headers.get('Authorization'));
    if (!tokenDigest) return unauthorized();
    const productGroupId = decodeGroupId(match[1]);
    if (!productGroupId) return json({ error: 'invalid_group' }, 400);

    const basis = operation === 'PUT' ? await readBody(request) : null;
    if (basis instanceof Response) return basis;

    let result: PreferenceResult;
    try {
      result = await execute(tokenDigest, productGroupId, operation, basis);
    } catch {
      return json({ error: 'preferences_unavailable' }, 503);
    }
    if (result.access === 'unauthenticated') return unauthorized();
    if (result.access === 'forbidden') return json({ error: 'forbidden' }, 403);
    return json({ basis: result.basis });
  };
}
