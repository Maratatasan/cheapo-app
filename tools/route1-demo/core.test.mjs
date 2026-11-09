import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { beginAuth, guard, imageRequest, inspectProviderResponse, readCompleted, readSafeProviderBody, safeProviderFailure, validateIdToken } from './core.mjs';

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
test('provider diagnostics retain safe status, code, field and request ID only', () => {
  const diagnostic = safeProviderFailure(400, 'req_abc123', { error: { code: 'subscription_sharing_unsupported_capability', param: 'text.format' }, detail: 'must not be surfaced' });
  assert.deepEqual(diagnostic, { status: 400, kind: 'error_object', code: 'subscription_sharing_unsupported_capability', param: 'text.format', requestId: 'req_abc123' });
  assert.deepEqual(safeProviderFailure(403, 'Bearer-secret', { error: { code: 'policy blocked (private)', param: 'image_url?secret' }, detail: 'private text' }), { status: 403, kind: 'error_object' });
  assert.deepEqual(safeProviderFailure(503, undefined, { detail: 'admission detail is not echoed' }), { status: 503, kind: 'other_json' });
  const completed = safeProviderFailure(200, 'req_z1234', { object: 'response', status: 'completed', output: [{ type: 'message', content: [{ text: 'private output' }] }] }, 'application/json; charset=utf-8', { redirected: false, finalOrigin: 'https://api.openai.com/v1/responses?secret=hidden' });
  assert.deepEqual(completed, { status: 200, contentType: 'application/json', kind: 'responses_object', responseStatus: 'completed', requestId: 'req_z1234', redirected: false, finalOrigin: 'https://api.openai.com' });
  assert.deepEqual(safeProviderFailure(200, undefined, undefined, 'text/html; charset=utf-8', { kind: 'html', redirected: false }), { status: 200, contentType: 'text/html', kind: 'html', redirected: false });
  assert.deepEqual(safeProviderFailure(200, undefined, undefined, '', { kind: 'empty' }), { status: 200, kind: 'empty' });
  assert.deepEqual(safeProviderFailure(200, undefined, undefined, 'application/octet-stream', { kind: 'unknown' }), { status: 200, contentType: 'application/octet-stream', kind: 'unknown' });
});
test('body classification reads bounded bytes when content type and length are absent', async () => {
  const jsonBody = new Response(Buffer.from(JSON.stringify({ object: 'response', status: 'completed', output: [{ type: 'message' }] })));
  assert.equal(jsonBody.headers.get('content-type'), null);
  assert.equal(jsonBody.headers.get('content-length'), null);
  const parsed = await readSafeProviderBody(jsonBody);
  assert.equal(parsed.payload.status, 'completed');
  assert.equal(safeProviderFailure(200, undefined, parsed.payload, null, { kind: parsed.kind }).kind, 'responses_object');
  assert.deepEqual(await readSafeProviderBody(new Response(null)), { kind: 'empty' });
  assert.deepEqual(await readSafeProviderBody(new Response(Buffer.from('<html>private page</html>'))), { kind: 'html' });
  assert.deepEqual(await readSafeProviderBody(new Response(Buffer.from('private plain text'))), { kind: 'unclassified_body' });
  assert.deepEqual(await readSafeProviderBody(new Response(Buffer.from('x'.repeat(129))), 128), { kind: 'body_too_large' });
  const sse = await readSafeProviderBody(new Response(Buffer.from('data: {"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"text":"private output"}]}]}}\n\n')));
  assert.equal(sse.kind, 'event_stream_body');
  assert.deepEqual(sse.eventTypes, ['response.completed']);
  assert.deepEqual(sse.payload, { status: 'completed' });
  assert.deepEqual(safeProviderFailure(200, 'req_sse123', sse.payload, null, { kind: sse.kind, eventTypes: sse.eventTypes }), { status: 200, kind: 'event_stream_body', responseStatus: 'completed', requestId: 'req_sse123', eventTypes: ['response.completed'] });
});
test('provider response inspection handles missing headers without consuming valid SSE', async () => {
  const metadata = (response, url = 'https://api.openai.com/v1/responses') => {
    Object.defineProperty(response, 'url', { value: url });
    Object.defineProperty(response, 'redirected', { value: false });
    return response;
  };
  const noHeadersJson = metadata(new Response(Buffer.from(JSON.stringify({ object: 'response', status: 'completed', output: [] }))));
  const jsonResult = await inspectProviderResponse(noHeadersJson);
  assert.equal(jsonResult.isStream, false);
  assert.deepEqual(jsonResult.diagnostics, { status: 200, kind: 'responses_object', responseStatus: 'completed', redirected: false, finalOrigin: 'https://api.openai.com' });
  const emptyResult = await inspectProviderResponse(metadata(new Response(null)));
  assert.equal(emptyResult.diagnostics.kind, 'empty');
  const noHeaderSse = metadata(new Response(Buffer.from('data: {"type":"response.completed","response":{"status":"completed"}}\n\n')));
  const sseResult = await inspectProviderResponse(noHeaderSse);
  assert.equal(sseResult.diagnostics.kind, 'event_stream_body');
  assert.deepEqual(sseResult.diagnostics.eventTypes, ['response.completed']);
  const properStream = metadata(new Response(Buffer.from('data: {"type":"response.completed"}\n\n'), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }));
  assert.deepEqual(await inspectProviderResponse(properStream), { isStream: true });
  assert.equal(properStream.bodyUsed, false);
  const failed = metadata(new Response(Buffer.from(JSON.stringify({ error: { code: 'subscription_sharing_unsupported_capability', param: 'text.format', message: 'hidden' } })), { status: 400, headers: { 'x-request-id': 'req_mock123' } }));
  assert.deepEqual((await inspectProviderResponse(failed)).diagnostics, { status: 400, kind: 'error_object', code: 'subscription_sharing_unsupported_capability', param: 'text.format', requestId: 'req_mock123', redirected: false, finalOrigin: 'https://api.openai.com' });
});
const draft = { product: 'Milk', price: 1.5, currency: 'GBP', uncertainty: '' };
function response(content = [{ type: 'output_text', text: JSON.stringify(draft) }], status = 'completed') { return { type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', role: 'assistant', status, content }] } }; }
async function* stream(events) { const bytes = Buffer.from(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')); for (let i = 0; i < bytes.length; i += 11) yield bytes.subarray(i, i + 11); }
test('stream yields only a completed assistant price draft', async () => {
  assert.deepEqual(await readCompleted(stream([{ type: 'response.output_text.delta', delta: 'partial' }, response()])), draft);
  for (const events of [[{ type: 'response.output_text.done', text: JSON.stringify(draft) }], [{ type: 'error' }], [{ type: 'response.failed' }], [{ type: 'response.incomplete' }], [{ type: 'response.refusal.delta', delta: 'No' }, response()], [{ type: 'response.refusal.done' }, response()], [response([{ type: 'refusal', refusal: 'No' }])], [response(undefined, 'in_progress')], [response([{ type: 'output_text', text: JSON.stringify({ ...draft, price: -1 }) }])]]) await assert.rejects(readCompleted(stream(events)));
});
test('stream failure keeps only safe code/param and HTTP metadata', async () => {
  const failed = { type: 'response.failed', response: { status: 'failed', error: { code: 'subscription_sharing_usage_unavailable', param: null, message: 'private provider detail' } } };
  await assert.rejects(readCompleted(stream([failed]), { status: 200, contentType: 'text/event-stream', requestId: 'req_stream123' }), error => {
    assert.deepEqual(error.diagnostics, { status: 200, contentType: 'text/event-stream', kind: 'response.failed', responseStatus: 'failed', code: 'subscription_sharing_usage_unavailable', requestId: 'req_stream123' });
    return true;
  });
  await assert.rejects(readCompleted(stream([{ type: 'response.completed', response: { status: 'incomplete', error: { code: 'subscription_sharing_usage_unavailable' } } }]), { status: 200, contentType: 'text/event-stream', requestId: 'req_stream123' }), error => {
    assert.deepEqual(error.diagnostics, { status: 200, contentType: 'text/event-stream', kind: 'response_not_completed', responseStatus: 'incomplete', code: 'subscription_sharing_usage_unavailable', requestId: 'req_stream123' });
    return true;
  });
  await assert.rejects(readCompleted(stream([]), { status: 200, contentType: 'text/event-stream' }), error => {
    assert.deepEqual(error.diagnostics, { status: 200, contentType: 'text/event-stream', kind: 'stream_empty' });
    return true;
  });
});
