import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

import { credentialDigest } from '../credential.ts';
import { createLocalApi } from '../local-api.ts';
import { postgresProductPresentationPhotos } from '../postgres-product-presentation-photo.ts';
import type { ShoppingTransaction } from '../postgres-shopping.ts';
import type { VerifyPhotoObject } from '../price-photo-upload.ts';

const host = process.env.CHEAPO_TEST_PG_SOCKET;
if (!host) throw Error('Run this suite through the disposable PostgreSQL test driver.');
const options = { host, port: Number(process.env.CHEAPO_TEST_PG_PORT), database: 'postgres' };
const operator = new Pool({ ...options, user: 'cheapo_test' });
const runtime = new Pool({ ...options, user: 'cheapo_fixture_product_photo_runtime' });
const fixture = (suffix: string) => `28600000-0000-4000-8000-0000000000${suffix}`;
const firstHome = fixture('01');
const secondHome = fixture('02');
const alice = fixture('11');
const ben = fixture('12');
const suspended = fixture('13');
const product = 'presentation-product-fixture';
const variant = 'presentation-variant-fixture';
const sourceId = 'presentation-existing-observation';
const credential = (suffix: string) => `cheapo_${'photo'.repeat(8)}${suffix}`;
const digest = (suffix: string) => credentialDigest(credential(suffix));
const transaction: ShoppingTransaction = async run => {
  const connection = await runtime.connect();
  try {
    await connection.query('BEGIN');
    const result = await run((sql, params) => connection.query(sql, params));
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally { connection.release(); }
};
const bytes = { sha256: 'a'.repeat(64), byteCount: 950, width: 400, height: 300 };
const plan = (operationId: string, expectedVersion = 0) => ({ ...bytes, operationId, expectedVersion });
let verify: VerifyPhotoObject;
const repository = postgresProductPresentationPhotos(transaction, (...args) => verify(...args));

before(async () => {
  await operator.query('CREATE ROLE cheapo_fixture_product_photo_runtime LOGIN IN ROLE cheapo_api_runtime');
  await operator.query('INSERT INTO cheapo.household VALUES ($1), ($2)', [firstHome, secondHome]);
  await operator.query('INSERT INTO cheapo.shopper VALUES ($1), ($2), ($3)', [alice, ben, suspended]);
  await operator.query(`
    INSERT INTO cheapo.household_membership (household_id, shopper_id, revoked_at)
    VALUES ($1, $2, NULL), ($3, $4, NULL), ($1, $5, statement_timestamp())
  `, [firstHome, alice, secondHome, ben, suspended]);
  for (const [token, home, shopper, expired] of [
    ['one', firstHome, alice, false], ['two', secondHome, ben, false],
    ['off', firstHome, suspended, false], ['old', firstHome, alice, true],
  ] as const) {
    await operator.query(`
      INSERT INTO cheapo.shopper_credential (token_digest, household_id, shopper_id, issued_at, expires_at)
      VALUES ($1, $2, $3, statement_timestamp() - interval '2 days',
        CASE WHEN $4::bool THEN statement_timestamp() - interval '1 day' ELSE statement_timestamp() + interval '1 day' END)
    `, [digest(token), home, shopper, expired]);
  }
  await operator.query(`INSERT INTO cheapo.product (id, gtin, name)
    VALUES ($1, '09028600000010', 'Fixture tea'), ($2, '09028600000027', 'Fixture variant')`, [product, variant]);
  await operator.query(`
    INSERT INTO cheapo.price_observation (household_id, shopper_id, id, product_id, captured_at, status, price_amount)
    VALUES ($1, $2, $3, $4, statement_timestamp(), 'complete', 2.50)
  `, [firstHome, alice, sourceId, product]);
  await operator.query(`
    INSERT INTO cheapo.price_photo (household_id, shopper_id, observation_id, role, storage_key, sha256, byte_count, width, height)
    VALUES ($1, $2, $3, 'original', 'shopping-import/fixture.jpg', $4, 50, 10, 5),
      ($1, $2, $3, 'crop', 'shopping-import/fixture-crop.jpg', $5, 25, 9, 4)
  `, [firstHome, alice, sourceId, 'c'.repeat(64), 'd'.repeat(64)]);
});

after(async () => { await runtime.end(); await operator.end(); });

test('inactive membership, invalid or expired credentials never reach object verification', async () => {
  verify = async () => assert.fail('Unauthorized verify');
  for (const [token, status] of [['off', 'forbidden'], ['old', 'unauthenticated'], ['bad', 'unauthenticated']] as const) {
    assert.deepEqual(await repository.read(digest(token), product), { status });
    assert.deepEqual(await repository.prepare(digest(token), product, plan('denied')), { status });
    assert.deepEqual(await repository.confirm(digest(token), product, 'denied'), { status });
  }
  assert.deepEqual(await repository.prepare(digest('one'), 'absent', plan('missing')), { status: 'not_found' });
});

test('only a verified, actor-bound upload becomes the canonical photo; price evidence stays intact', async () => {
  const before = await operator.query(`
    SELECT to_jsonb(o) AS observation, to_jsonb(f) AS photo, p.record_version
    FROM cheapo.price_observation o JOIN cheapo.price_photo f
      ON (f.household_id, f.shopper_id, f.observation_id) = (o.household_id, o.shopper_id, o.id)
    JOIN cheapo.product p ON p.id = o.product_id WHERE o.id = $1 ORDER BY f.role
  `, [sourceId]);
  const first = plan('initial');
  const pending = await repository.prepare(digest('one'), product, first);
  assert.equal(pending.status, 'pending');
  if (pending.status !== 'pending') assert.fail('Missing upload plan');
  assert.match(pending.key, /^product-presentation\/[a-f0-9-]{36}\.jpg$/);
  assert.deepEqual(await repository.prepare(digest('one'), product, first), pending);
  assert.deepEqual(await repository.prepare(digest('one'), variant, first), { status: 'operation_conflict' });
  assert.deepEqual(await repository.prepare(digest('one'), product, { ...first, width: 200 }), { status: 'operation_conflict' });
  assert.deepEqual(await repository.read(digest('two'), product), { status: 'not_found' });
  assert.deepEqual(await repository.confirm(digest('two'), product, first.operationId), { status: 'not_found' });
  verify = async (key, metadata, signal) => {
    assert.equal(key, pending.key);
    assert.deepEqual(metadata, bytes);
    assert.equal(signal.aborted, false);
    return 'missing';
  };
  assert.deepEqual(await repository.confirm(digest('one'), product, first.operationId), { status: 'pending' });
  verify = async () => 'mismatch';
  assert.deepEqual(await repository.confirm(digest('one'), product, first.operationId), { status: 'mismatch' });
  assert.deepEqual(await repository.read(digest('two'), product), { status: 'not_found' });
  verify = async () => 'verified';
  assert.deepEqual(await repository.confirm(digest('one'), product, first.operationId), { status: 'available', version: 1 });
  for (const token of ['one', 'two']) {
    assert.deepEqual(await repository.read(digest(token), product), {
      status: 'available', photo: { ...bytes, key: pending.key, version: 1 },
    });
    assert.deepEqual(await repository.read(digest(token), variant), { status: 'not_found' });
  }
  const after = await operator.query(`
    SELECT to_jsonb(o) AS observation, to_jsonb(f) AS photo, p.record_version
    FROM cheapo.price_observation o JOIN cheapo.price_photo f
      ON (f.household_id, f.shopper_id, f.observation_id) = (o.household_id, o.shopper_id, o.id)
    JOIN cheapo.product p ON p.id = o.product_id WHERE o.id = $1 ORDER BY f.role
  `, [sourceId]);
  assert.deepEqual(after.rows, before.rows);
});

test('concurrent cross-household replacements keep one active revision and replay lost acknowledgements', async () => {
  const replacement = plan('same-operation-id', 1);
  const [first, second] = await Promise.all([
    repository.prepare(digest('one'), product, replacement), repository.prepare(digest('two'), product, replacement),
  ]);
  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'pending');
  assert.notDeepEqual(first, second);
  const current = await repository.read(digest('one'), product);
  verify = async () => 'mismatch';
  assert.deepEqual(await repository.confirm(digest('one'), product, replacement.operationId), { status: 'mismatch' });
  assert.deepEqual(await repository.read(digest('two'), product), current);

  let release!: () => void;
  const bothChecks = new Promise<void>(resolve => { release = resolve; });
  let checks = 0;
  verify = async (_key, _metadata, signal) => {
    if (++checks === 2) release();
    await Promise.race([bothChecks, new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })]);
    return 'verified';
  };
  const results = await Promise.all([
    repository.confirm(digest('one'), product, replacement.operationId),
    repository.confirm(digest('two'), product, replacement.operationId),
  ]);
  assert.equal(checks, 2);
  assert.deepEqual(results.map(result => result.status).sort(), ['available', 'version_conflict']);
  const winner = results[0].status === 'available' ? 'one' : 'two';
  const loser = winner === 'one' ? 'two' : 'one';
  verify = async () => assert.fail('Replays and version conflicts must not verify again');
  const accepted = { status: 'available', version: 2 };
  assert.deepEqual(await repository.prepare(digest(winner), product, replacement), accepted);
  assert.deepEqual(await repository.confirm(digest(winner), product, replacement.operationId), accepted);
  assert.deepEqual(await repository.confirm(digest(loser), product, replacement.operationId), { status: 'version_conflict', currentVersion: 2 });
  assert.deepEqual(await repository.confirm(digest('one'), product, 'initial'), { status: 'available', version: 1 });
  assert.deepEqual(await repository.read(digest('one'), product), await repository.read(digest('two'), product));
  assert.equal((await operator.query(`SELECT published_version FROM cheapo.product_presentation_photo
    WHERE product_id=$1 AND published_version IS NOT NULL`, [product])).rowCount, 2);
});

test('runtime may publish a revision but may not rewrite metadata or remove receipts', async () => {
  await assert.rejects(runtime.query(`UPDATE cheapo.product_presentation_photo SET width = 1`), { code: '42501' });
  await assert.rejects(runtime.query('DELETE FROM cheapo.product_presentation_photo'), { code: '42501' });
});

test('the shared router signs only valid product photo operations and keeps its private audit fields internal', async () => {
  const getUrl = 'https://objects.example/short-read';
  const putUrl = 'https://objects.example/short-upload';
  const headers = { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' };
  let uploadKey: string | undefined;
  let readKey: string | undefined;
  const api = createLocalApi(runtime, {
    read: async key => { readKey = key; return getUrl; },
    upload: async (key, details) => {
      assert.deepEqual(details, bytes);
      uploadKey = key;
      return { url: putUrl, headers };
    },
    verify: async (key, details) => {
      assert.equal(key, uploadKey);
      assert.deepEqual(details, bytes);
      return 'verified';
    },
  });
  const path = `/v1/products/${variant}/presentation-photo`;
  const write = `${path}/upload`;
  const operationId = 'real-router-fixture';
  function request(pathname: string, actor?: string, method = 'GET', body?: object) {
    const headers = new Headers(actor ? { Authorization: `Bearer ${credential(actor)}` } : {});
    if (body) headers.set('Content-Type', 'application/json');
    return api(new Request(`https://api.example${pathname}`, { method, headers, body: body && JSON.stringify(body) }));
  }

  assert.equal((await request(path)).status, 401);
  assert.equal((await request(write, 'off', 'PUT', plan(operationId))).status, 403);
  assert.equal((await request(path, 'two', 'PATCH')).status, 405);
  assert.equal((await request(`${path}?uploader=me`, 'two')).status, 400);
  for (const invalid of [{ actorShopperId: alice }, { byteCount: 8 * 1024 * 1024 + 1 }, { width: 4097 }]) {
    assert.equal((await request(write, 'one', 'PUT', { ...plan(operationId), ...invalid })).status, 400);
  }
  assert.equal(uploadKey, undefined);
  assert.equal((await request(path, 'two')).status, 404);
  assert.equal(readKey, undefined);
  const prepared = await request(write, 'one', 'PUT', plan(operationId));
  assert.equal(prepared.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await prepared.json(), { availability: 'pending', url: putUrl, headers, expiresInSeconds: 120 });
  assert.equal((await request(write, 'two', 'POST', { operationId })).status, 404);
  for (let attempt = 0; attempt < 2; attempt++) {
    const confirmed = await request(write, 'one', 'POST', { operationId });
    assert.deepEqual(await confirmed.json(), { availability: 'available', version: 1 });
  }
  const stale = await request(write, 'two', 'PUT', plan('stale'));
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: 'photo_version_conflict', currentVersion: 1 });
  const fetched = await request(path, 'two');
  assert.equal(fetched.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await fetched.json(), { ...bytes, version: 1, url: getUrl, expiresInSeconds: 60 });
  assert.equal(readKey, uploadKey);
});
