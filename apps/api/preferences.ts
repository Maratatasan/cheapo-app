import { z } from 'zod';

import { json, readJson, unauthorized } from './api-http.ts';
import { readCredentialDigest } from './credential.ts';

// Keep aligned with the comparison bases used for confirmed package measures.
const allowedBases = ['kg', '100g', 'litre', '100mL', 'item', 'wash'] as const;
export type ComparisonBasis = typeof allowedBases[number];
type PreferenceState = { basis: ComparisonBasis | null; version: number };
export type PreferenceAction =
  | { kind: 'read' }
  | { kind: 'write'; basis: ComparisonBasis | null; operation?: { operationId: string; expectedVersion: number } };
export type PreferenceResult =
  | ({ status: 'ok' } & PreferenceState)
  | { status: 'version_conflict'; current: PreferenceState }
  | { status: 'operation_conflict' | 'unauthenticated' | 'forbidden' };
export type ExecutePreference = (tokenDigest: string, productGroupId: string, action: PreferenceAction) => Promise<PreferenceResult>;

const conditionalWrite = z.strictObject({
  operationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  expectedVersion: z.number().int().min(0).max(2_147_483_647),
  basis: z.enum(allowedBases).nullable(),
});
const maxBodyBytes = 512;
const pathPattern = /^\/v1\/me\/comparison-preferences\/([^/]+)$/;

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

async function readAction(request: Request): Promise<PreferenceAction | Response> {
  if (request.method === 'GET') return { kind: 'read' };
  if (request.method === 'DELETE') return { kind: 'write', basis: null };
  const body = await readJson(request, maxBodyBytes, 'invalid_basis');
  if (body instanceof Response) return body;
  if (request.method === 'PATCH') {
    const result = conditionalWrite.safeParse(body.value);
    if (!result.success) return json({ error: 'invalid_basis' }, 400);
    const { basis, ...operation } = result.data;
    return { kind: 'write', basis, operation };
  }
  const basis = readBasis(body.value);
  return basis ? { kind: 'write', basis } : json({ error: 'invalid_basis' }, 400);
}

export function createPreferencesHandler(execute: ExecutePreference) {
  return async (request: Request): Promise<Response> => {
    const match = pathPattern.exec(new URL(request.url).pathname);
    if (!match) return json({ error: 'not_found' }, 404);

    const operation = request.method;
    if (operation !== 'GET' && operation !== 'PUT' && operation !== 'DELETE' && operation !== 'PATCH') {
      return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, PUT, PATCH, DELETE' });
    }

    const tokenDigest = readCredentialDigest(request.headers.get('Authorization'));
    if (!tokenDigest) return unauthorized();
    const productGroupId = decodeGroupId(match[1]);
    if (!productGroupId) return json({ error: 'invalid_group' }, 400);

    const action = await readAction(request);
    if (action instanceof Response) return action;

    try {
      const result = await execute(tokenDigest, productGroupId, action);
      switch (result.status) {
        case 'ok': {
          const body = operation === 'PATCH' ? { basis: result.basis, version: result.version } : { basis: result.basis };
          return json(body, 200, { ETag: `"${result.version}"` });
        }
        case 'version_conflict': return json({ error: 'version_conflict',
          currentVersion: result.current.version, current: { basis: result.current.basis } }, 409);
        case 'operation_conflict': return json({ error: 'operation_conflict' }, 409);
        case 'unauthenticated': return unauthorized();
        case 'forbidden': return json({ error: 'forbidden' }, 403);
      }
    } catch {
      return json({ error: 'preferences_unavailable' }, 503);
    }
  };
}
