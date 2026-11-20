import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPreferencesHandler } from '../preferences.ts';

const route = 'http://localhost/v1/me/comparison-preferences/laundry%20liquid';
const authorization = `Bearer cheapo_${'A'.repeat(43)}`;
const handle = createPreferencesHandler(async () => {
  throw new Error('Malformed HTTP requests should never reach PostgreSQL');
});

test('rejects a preference write with a caller-supplied identity', async () => {
  const response = await handle(new Request(route, {
    method: 'PUT',
    headers: { authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ basis: 'wash', userId: 'another-shopper' }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_basis' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('requires a Cheapo credential before looking up preferences', async () => {
  for (const headers of [undefined, { authorization: 'Bearer another-service-token' }]) {
    const response = await handle(new Request(route, { headers }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('WWW-Authenticate'), 'Bearer');
  }
});

test('rejects unsupported basis values before querying PostgreSQL', async () => {
  const response = await handle(new Request(route, {
    method: 'PUT',
    headers: { authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ basis: 'pack' }),
  }));
  assert.equal(response.status, 400);
});

test('rejects an oversized replacement before querying PostgreSQL', async () => {
  const response = await handle(new Request(route, {
    method: 'PUT',
    headers: { authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ basis: 'x'.repeat(1024) }),
  }));
  assert.equal(response.status, 413);
});
