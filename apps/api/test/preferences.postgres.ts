import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

import { postgresPreferences } from '../postgres.ts';
import { createPreferencesHandler } from '../preferences.ts';
import { localHttpServer } from '../server.ts';

const host = process.env.CHEAPO_TEST_PG_SOCKET;
if (!host) throw new Error('Run this test with pnpm --filter @cheapo/api test:postgres.');
const connection = { host, port: 5432, user: 'cheapo_test', database: 'postgres', ssl: false };
const pool = new Pool(connection);
const household = '00000000-0000-4000-8000-000000000001';
const otherHousehold = '00000000-0000-4000-8000-000000000002';
const alex = '00000000-0000-4000-8000-000000000011';
const sam = '00000000-0000-4000-8000-000000000012';
const robin = '00000000-0000-4000-8000-000000000013';
const token = (letter: string) => `cheapo_${letter.repeat(43)}`;
const server = localHttpServer(createPreferencesHandler(postgresPreferences(pool)));

async function issueSyntheticToken(letter: string, shopper: string, home: string, expiresAt: string) {
  const digest = createHash('sha256').update(token(letter)).digest('hex');
  await pool.query(`INSERT INTO cheapo.shopper_credential
    (token_digest, household_id, shopper_id, issued_at, expires_at)
    VALUES ($1, $2, $3, statement_timestamp() - interval '2 days', $4)`, [digest, home, shopper, expiresAt]);
}

before(async () => {
  await pool.query('INSERT INTO cheapo.household VALUES ($1), ($2)', [household, otherHousehold]);
  await pool.query('INSERT INTO cheapo.shopper VALUES ($1), ($2), ($3)', [alex, sam, robin]);
  await pool.query(`INSERT INTO cheapo.household_membership (household_id, shopper_id, revoked_at)
    VALUES ($1, $2, NULL), ($1, $3, NULL), ($4, $5, NULL), ($1, $5, statement_timestamp())`,
  [household, alex, sam, otherHousehold, robin]);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  await issueSyntheticToken('A', alex, household, tomorrow);
  await issueSyntheticToken('B', sam, household, tomorrow);
  await issueSyntheticToken('C', robin, otherHousehold, tomorrow);
  await issueSyntheticToken('D', robin, household, tomorrow);
  await issueSyntheticToken('E', alex, household, yesterday);
  await issueSyntheticToken('F', alex, household, tomorrow);
  await pool.query('UPDATE cheapo.shopper_credential SET revoked_at = statement_timestamp() WHERE token_digest = $1',
    [createHash('sha256').update(token('F')).digest('hex')]);
  await issueSyntheticToken('G', alex, household, tomorrow);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
});

async function request(letter: string, group: string, method = 'GET', basis?: string, target = server) {
  const address = target.address();
  assert(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/me/comparison-preferences/${encodeURIComponent(group)}`, {
    method,
    headers: { Authorization: `Bearer ${token(letter)}`, 'Content-Type': 'application/json' },
    body: basis === undefined ? undefined : JSON.stringify({ basis }),
  });
  return { status: response.status, body: await response.json() };
}

const ok = (basis: string | null) => ({ status: 200, body: { basis } });

test('reopens the shopper’s choice through a fresh API instance and second credential', async () => {
  const group = 'laundry liquid';
  assert.deepEqual(await request('A', group), ok(null));
  assert.deepEqual(await request('A', group, 'PUT', 'wash'), ok('wash'));

  const newPool = new Pool(connection);
  const newServer = localHttpServer(createPreferencesHandler(postgresPreferences(newPool)));
  newServer.listen(0, '127.0.0.1');
  await once(newServer, 'listening');
  try {
    assert.deepEqual(await request('G', group, 'GET', undefined, newServer), ok('wash'));
  } finally {
    await new Promise<void>(resolve => newServer.close(() => resolve()));
    await newPool.end();
  }
});

test('keeps preferences separate across shoppers and product groups', async () => {
  const group = 'lait fermenté';
  assert.deepEqual(await request('A', group, 'PUT', '100mL'), ok('100mL'));
  assert.deepEqual(await request('B', group, 'PUT', 'litre'), ok('litre'));
  assert.deepEqual(await request('A', group), ok('100mL'));
  assert.deepEqual(await request('B', group), ok('litre'));
  assert.deepEqual(await request('C', group), ok(null));
  assert.deepEqual(await request('A', 'yogurt'), ok(null));
});

test('refuses expired, revoked, unknown and out-of-household access', async () => {
  for (const letter of ['E', 'F', 'Z']) {
    assert.deepEqual(await request(letter, 'coffee'), { status: 401, body: { error: 'unauthenticated' } });
  }
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const basis = method === 'PUT' ? 'kg' : undefined;
    assert.deepEqual(await request('D', 'coffee', method, basis), { status: 403, body: { error: 'forbidden' } });
  }
});

test('retries replacement and clearing without changing another shopper’s preference', async () => {
  const group = 'tomatoes';
  assert.deepEqual(await request('B', group, 'PUT', 'kg'), ok('kg'));
  assert.deepEqual(await Promise.all([request('A', group, 'PUT', 'item'), request('A', group, 'PUT', 'item')]),
    [ok('item'), ok('item')]);
  assert.deepEqual(await request('A', group), ok('item'));
  assert.deepEqual(await request('A', group, 'DELETE'), ok(null));
  assert.deepEqual(await request('A', group, 'DELETE'), ok(null));
  assert.deepEqual(await request('A', group), ok(null));
  assert.deepEqual(await request('B', group), ok('kg'));
});
