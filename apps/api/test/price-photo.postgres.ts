import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

import { credentialDigest } from '../credential.ts';
import { importedEvidenceKey } from '../evidence-key.ts';
import { createLocalApi } from '../local-api.ts';

const host = process.env.CHEAPO_TEST_PG_SOCKET;
if (!host) throw new Error('Run this suite through the disposable PostgreSQL test driver.');
const options = { host, port: Number(process.env.CHEAPO_TEST_PG_PORT), user: 'cheapo_test', database: 'postgres' };
const operator = new Pool(options);
const runtime = new Pool({ ...options, user: 'cheapo_fixture_photo_runtime' });
const household = '19000000-0000-4000-8000-000000000001';
const outside = '19000000-0000-4000-8000-000000000002';
const owner = '19000000-0000-4000-8000-000000000011';
const peer = '19000000-0000-4000-8000-000000000012';
const outsider = '19000000-0000-4000-8000-000000000013';
const completed = '19000000-0000-4000-8000-000000000021';
const draft = '19000000-0000-4000-8000-000000000022';
const testRecord = '19000000-0000-4000-8000-000000000023';
const invalidObject = '19000000-0000-4000-8000-000000000024';
const token = (letter: string) => `cheapo_${'r190'.repeat(10)}${letter.repeat(3)}`;
const signed: string[] = [];
const signedFixture = 'https://evidence.example/fixture-url';
const api = createLocalApi(runtime, async key => {
  signed.push(key);
  return signedFixture;
});

before(async () => {
  await operator.query('CREATE ROLE cheapo_fixture_photo_runtime LOGIN IN ROLE cheapo_api_runtime');
  await operator.query('INSERT INTO cheapo.household VALUES ($1), ($2)', [household, outside]);
  await operator.query('INSERT INTO cheapo.shopper VALUES ($1), ($2), ($3)', [owner, peer, outsider]);
  await operator.query(`
    INSERT INTO cheapo.household_membership (household_id, shopper_id, revoked_at)
    VALUES ($1, $2, NULL), ($1, $3, NULL), ($4, $5, NULL), ($1, $5, statement_timestamp())
  `, [household, owner, peer, outside, outsider]);
  for (const [letter, home, person, expired] of [
    ['A', household, owner, false], ['B', household, peer, false], ['C', outside, outsider, false],
    ['D', household, outsider, false], ['E', household, owner, true],
  ] as const) {
    await operator.query(`
      INSERT INTO cheapo.shopper_credential (token_digest, household_id, shopper_id, issued_at, expires_at)
      VALUES ($1, $2, $3, statement_timestamp() - interval '2 days',
        CASE WHEN $4::bool THEN statement_timestamp() - interval '1 day' ELSE statement_timestamp() + interval '1 day' END)
    `, [credentialDigest(token(letter)), home, person, expired]);
  }
  for (const [resourceId, status, testShop] of [
    [completed, 'complete', false], [draft, 'draft', false],
    [testRecord, 'complete', true], [invalidObject, 'complete', false],
  ]) {
    const sourceId = 'restored-' + resourceId;
    await operator.query(`
      INSERT INTO cheapo.price_observation (household_id, shopper_id, id, resource_id, captured_at, status, source_test_shop)
      VALUES ($1, $2, $3, $4, statement_timestamp(), $5, $6)
    `, [household, owner, sourceId, resourceId, status, testShop]);
    const sha = 'a'.repeat(64);
    const key = resourceId === invalidObject ? 'deployment-artifacts/fixture.zip' : importedEvidenceKey(household, owner, sha);
    await operator.query(`
      INSERT INTO cheapo.price_photo (household_id, shopper_id, observation_id, role, storage_key, sha256, byte_count, width, height)
      VALUES ($1, $2, $3, 'original', $4, $5, 2200, 800, 600)
    `, [household, owner, sourceId, key, sha]);
  }
  const sha = 'b'.repeat(64);
  await operator.query(`
    INSERT INTO cheapo.price_photo (household_id, shopper_id, observation_id, role, storage_key, sha256, byte_count, width, height)
    VALUES ($1, $2, $3, 'crop', $4, $5, 1100, 400, 300)
  `, [household, owner, 'restored-' + completed, importedEvidenceKey(household, owner, sha), sha]);
});

after(async () => {
  await runtime.end();
  await operator.end();
});

function photo(id: string, role: string, actor?: string, query = '') {
  const headers = actor ? { Authorization: `Bearer ${token(actor)}` } : undefined;
  return api(new Request(`http://localhost/v1/me/price-observations/${id}/photos/${role}${query}`, { headers }));
}

test('issues separate short-lived grants for a completed original and crop to a household peer', async () => {
  for (const [role, hash, byteCount, width, height] of [
    ['original', 'a'.repeat(64), '2200', 800, 600],
    ['crop', 'b'.repeat(64), '1100', 400, 300],
  ] as const) {
    const response = await photo(completed, role, 'B');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      role, sha256: hash, byteCount, width, height, url: signedFixture, expiresInSeconds: 60,
    });
    assert.equal(signed.at(-1), importedEvidenceKey(household, owner, hash));
  }
});

test('never signs absent, foreign, test-shop or unexpected object references', async () => {
  const before = signed.length;
  assert.equal((await photo(completed, 'original', 'C')).status, 404);
  assert.equal((await photo(testRecord, 'original', 'A')).status, 404);
  assert.equal((await photo(invalidObject, 'original', 'A')).status, 404);
  assert.equal((await photo(draft, 'crop', 'A')).status, 404);
  assert.equal((await photo(completed, 'arbitrary', 'A')).status, 400);
  assert.equal((await photo('restored-' + completed, 'original', 'A')).status, 400);
  assert.equal((await photo(completed, 'original', 'A', '?key=deployment-artifacts')).status, 400);
  assert.equal(signed.length, before);
});

test('allows private draft recovery only for its active enrolled owner', async () => {
  const before = signed.length;
  assert.equal((await photo(draft, 'original')).status, 401);
  assert.equal((await photo(draft, 'original', 'E')).status, 401);
  assert.equal((await photo(draft, 'original', 'D')).status, 403);
  assert.equal((await photo(draft, 'original', 'B')).status, 404);
  assert.equal(signed.length, before);
  assert.equal((await photo(draft, 'original', 'A')).status, 200);
  assert.equal(signed.length, before + 1);
});
