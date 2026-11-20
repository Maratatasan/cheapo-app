import { json, unauthorized } from './api-http.ts';
import { readCredentialDigest } from './credential.ts';
import { readShoppingMember, type ShoppingQuery } from './postgres-shopping.ts';

export function createShoppingIdentityHandler(query: ShoppingQuery) {
  return async (request: Request) => {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });
    const digest = readCredentialDigest(request.headers.get('Authorization'));
    if (!digest) return unauthorized();
    if (new URL(request.url).searchParams.size) return json({ error: 'invalid_identity_query' }, 400);

    try {
      const member = await readShoppingMember(query, digest);
      if (!member) return unauthorized();
      if (!member.active) return json({ error: 'forbidden' }, 403);
      return json({ householdId: member.household_id, shopperId: member.shopper_id });
    } catch {
      return json({ error: 'identity_unavailable' }, 503);
    }
  };
}
