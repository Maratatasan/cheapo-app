import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { beginAuth, guard, imageRequest, readCompleted, validateIdToken } from './core.mjs';

test('fresh OAuth state, nonce, PKCE and exact callback with dynamic registration', () => {
  const hostId = 'urn:uuid:821e1a44-0f2d-4d0a-9354-52cbd8e1f937';
  const a = beginAuth({ port: 8766, hostId }); const b = beginAuth({ port: 8766, hostId });
  const url = new URL(a.url);
  assert.equal(url.origin + url.pathname, 'https://auth.openai.com/api/accounts/authorize');
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8766/auth/callback');
  assert.equal(url.searchParams.get('ext_agent_host_id'), hostId);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(a.flow.verifier).digest('base64url'));
  assert.notEqual(a.flow.state, b.flow.state); assert.notEqual(a.flow.nonce, b.flow.nonce);
  assert.match(url.searchParams.get('scope'), /chatgpt.tokens.use.direct/);
  const returning = new URL(beginAuth({ port: 8766, hostId, clientId: 'oaiapp_registered' }).url);
  assert.equal(returning.searchParams.get('client_id'), 'oaiapp_registered');
  assert.equal(returning.searchParams.has('agent_name_hint'), false);
});
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', use: 'sig' }] };
const valid = { iss: 'https://auth.openai.com', aud: 'issued-client', sub: 'person', exp: 1100, iat: 950, nonce: 'nonce' };
const expectations = { issuer: valid.iss, audience: valid.aud, nonce: valid.nonce, now: 1000 };
function jwt(claims = valid, header = { alg: 'RS256', kid: 'test' }) {
  const data = [header, claims].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return `${data}.${sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url')}`;
}
test('JWT verifies signature and required claims', () => {
  assert.equal(validateIdToken(jwt(), jwks, expectations).sub, 'person');
  for (const patch of [{ iss: 'other' }, { aud: 'other' }, { nonce: 'other' }, { exp: 994 }, { iat: 1006 }, { sub: '' }, { exp: undefined }, { iat: undefined }, { nbf: 1006 }, { aud: ['issued-client', 'other'], azp: 'other' }]) assert.throws(() => validateIdToken(jwt({ ...valid, ...patch }), jwks, expectations));
  assert.throws(() => validateIdToken(jwt(valid, { alg: 'none', kid: 'test' }), jwks, expectations));
  const pieces = jwt().split('.'); pieces[1] = Buffer.from(JSON.stringify({ ...valid, sub: 'tampered' })).toString('base64url');
  assert.throws(() => validateIdToken(pieces.join('.'), jwks, expectations));
  assert.throws(() => validateIdToken(jwt(), { keys: [] }, expectations));
  assert.equal(validateIdToken(jwt({ ...valid, exp: 996, iat: 950 }), jwks, expectations).sub, 'person');
  assert.equal(validateIdToken(jwt({ ...valid, iat: 1004 }), jwks, expectations).sub, 'person');
});
test('request guard rejects foreign hosts, origins, missing CSRF and non-JSON', () => {
  const req = { method: 'POST', headers: { host: '127.0.0.1:8765', origin: 'http://127.0.0.1:8765', 'x-csrf-token': 'secret', 'content-type': 'application/json' } };
  guard(req, req.headers.origin, 'secret');
  for (const patch of [{ host: 'evil.test:8765' }, { origin: 'http://evil.test' }, { 'x-csrf-token': '' }, { 'content-type': 'text/plain' }]) assert.throws(() => guard({ ...req, headers: { ...req.headers, ...patch } }, req.headers.origin, 'secret'));
});
const image = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;
test('image request uses explicit model, schema, no storage and streaming', () => {
  const request = imageRequest({ model: 'model', image }, ['model']);
  assert.equal(request.store, false); assert.equal(request.stream, true);
  assert.equal('max_output_tokens' in request, false);
  assert.equal(request.text.format.strict, true);
  assert.deepEqual(request.text.format.schema.required, ['product', 'price', 'currency', 'uncertainty']);
  assert.throws(() => imageRequest({ model: 'unlisted', image }, ['model']));
  assert.throws(() => imageRequest({ model: 'model', image: 'data:image/png;base64,YmFk' }, ['model']));
  assert.throws(() => imageRequest({ model: 'model', image: 'x'.repeat(8_000_001) }, ['model']));
});
const draft = { product: 'Milk', price: 1.5, currency: 'GBP', uncertainty: '' };
function response(content = [{ type: 'output_text', text: JSON.stringify(draft) }], status = 'completed') { return { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', status, content }] } }; }
async function* stream(events) { const bytes = Buffer.from(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')); for (let i = 0; i < bytes.length; i += 11) yield bytes.subarray(i, i + 11); }
test('stream yields only a completed assistant price draft', async () => {
  assert.deepEqual(await readCompleted(stream([{ type: 'response.output_text.delta', delta: 'partial' }, response()])), draft);
  for (const events of [[{ type: 'response.output_text.done', text: JSON.stringify(draft) }], [{ type: 'error' }], [{ type: 'response.failed' }], [{ type: 'response.incomplete' }], [{ type: 'response.refusal.delta', delta: 'No' }, response()], [{ type: 'response.refusal.done' }, response()], [response([{ type: 'refusal', refusal: 'No' }])], [response(undefined, 'in_progress')], [response([{ type: 'output_text', text: JSON.stringify({ ...draft, price: -1 }) }])]]) await assert.rejects(readCompleted(stream(events)));
});
