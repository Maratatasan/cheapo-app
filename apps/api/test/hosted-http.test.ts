import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGatewayHandler } from '../hosted-http.ts';

const envelope = {
  version: '2.0',
  rawPath: '/v1/products/group%20name',
  rawQueryString: 'filter=a%2Bb&filter=c',
  requestContext: { http: { method: 'PATCH' } },
  headers: { Authorization: 'Bearer fixture-only', 'Content-Type': 'application/json' },
};

test('preserves encoded application route, method, query, bearer, and base64 body', async () => {
  const handle = createGatewayHandler(async request => {
    assert.equal(request.method, 'PATCH');
    const url = new URL(request.url);
    assert.equal(url.pathname, '/v1/products/group%20name');
    assert.deepEqual(url.searchParams.getAll('filter'), ['a+b', 'c']);
    assert.equal(request.headers.get('authorization'), 'Bearer fixture-only');
    assert.deepEqual(await request.json(), { name: 'Café' });
    return Response.json({ updated: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  });
  const response = await handle({
    ...envelope, body: Buffer.from('{"name":"Café"}').toString('base64'), isBase64Encoded: true,
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body), { updated: true });
});

test('preserves challenge status and headers without converting an absent body', async () => {
  const handle = createGatewayHandler(async request => {
    assert.equal(request.body, null);
    return Response.json({ error: 'unauthenticated' }, {
      status: 401, headers: { 'WWW-Authenticate': 'Bearer', 'Cache-Control': 'no-store' },
    });
  });
  const response = await handle({
    ...envelope, requestContext: { http: { method: 'GET' } }, headers: {},
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers['www-authenticate'], 'Bearer');
});

test('rejects invalid gateway input before routing and suppresses internal errors', async () => {
  let calls = 0;
  const handle = createGatewayHandler(async () => {
    calls += 1;
    throw new Error('sensitive fixture');
  });
  const malformed = await handle({ ...envelope, rawPath: '//other.example/v1/shops' });
  assert.equal(malformed.statusCode, 400);
  assert.equal(calls, 0);
  const failure = await handle(envelope);
  assert.equal(failure.statusCode, 500);
  assert.equal(failure.headers['cache-control'], 'no-store');
  assert.equal(failure.body.includes('sensitive fixture'), false);
});

test('rejects oversized text and base64 metadata before reaching the app', async () => {
  const oversized = 'a'.repeat(256 * 1024 + 1);
  const handle = createGatewayHandler(async () => {
    throw new Error('Oversized requests must never reach app routes.');
  });
  const open = await handle({ ...envelope, body: oversized });
  const encoded = await handle({
    ...envelope, body: Buffer.from(oversized).toString('base64'), isBase64Encoded: true,
  });
  assert.equal(open.statusCode, 413);
  assert.equal(encoded.statusCode, 413);
});
