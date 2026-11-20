import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

import { credentialDigest } from '../credential.ts';
import { createLocalApi } from '../local-api.ts';

const host = process.env.CHEAPO_TEST_PG_SOCKET;
if (!host) throw new Error('Run this suite through the disposable PostgreSQL test driver.');
const options = {
  host, port: Number(process.env.CHEAPO_TEST_PG_PORT), user: 'cheapo_test', database: 'postgres', ssl: false,
};
const operator = new Pool(options);
const runtime = new Pool({ ...options, user: 'cheapo_fixture_runtime' });
const api = createLocalApi(runtime);
const household = '00700000-0000-4000-8000-000000000001';
const anotherHousehold = '00700000-0000-4000-8000-000000000002';
const shopper = '00700000-0000-4000-8000-000000000011';
const anotherShopper = '00700000-0000-4000-8000-000000000012';
const first = '/v1/me/saved-shops/role-fixture-shop';
const token = (letter: string) => `cheapo_${'r007'.repeat(10)}${letter.repeat(3)}`;

before(async () => {
  await operator.query('CREATE ROLE cheapo_fixture_runtime LOGIN IN ROLE cheapo_api_runtime');
  await operator.query('INSERT INTO cheapo.household VALUES ($1), ($2)', [household, anotherHousehold]);
  await operator.query('INSERT INTO cheapo.shopper VALUES ($1), ($2)', [shopper, anotherShopper]);
  await operator.query(`
    INSERT INTO cheapo.household_membership (household_id, shopper_id, revoked_at)
    VALUES ($1, $2, NULL), ($3, $4, NULL), ($1, $4, statement_timestamp())
  `, [household, shopper, anotherHousehold, anotherShopper]);
  for (const [letter, home, person, situation] of [
    ['A', household, shopper, 'open'],
    ['B', anotherHousehold, anotherShopper, 'open'],
    ['C', household, anotherShopper, 'open'],
    ['D', household, shopper, 'expired'],
    ['E', household, shopper, 'revoked'],
  ]) {
    await operator.query(`
      INSERT INTO cheapo.shopper_credential (token_digest, household_id, shopper_id, issued_at, expires_at, revoked_at)
      VALUES ($1, $2, $3, statement_timestamp() - interval '2 days',
        CASE WHEN $4 = 'expired' THEN statement_timestamp() - interval '1 day' ELSE statement_timestamp() + interval '1 day' END,
        CASE WHEN $4 = 'revoked' THEN statement_timestamp() END)
    `, [credentialDigest(token(letter)), home, person, situation]);
  }
});

after(async () => {
  await runtime.end();
  await operator.end();
});

function request(path: string, letter: string, method = 'GET', body?: object) {
  return api(new Request('http://localhost' + path, {
    method,
    headers: { Authorization: `Bearer ${token(letter)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

test('runtime denies invalid credentials and limits a valid shop operation to its household', async () => {
  for (const letter of ['D', 'E', 'Z']) assert.equal((await request(first, letter, 'DELETE')).status, 401);
  assert.equal((await request(first, 'C', 'DELETE')).status, 403);

  const created = await request(first, 'A', 'PUT', { name: 'Role fixture shop', nickname: 'First home', select: true });
  assert.equal(created.status, 200);
  const shop = { id: 'role-fixture-shop', name: 'Role fixture shop', nickname: 'First home' };
  assert.deepEqual(await created.json(), { shops: [shop], currentShop: shop });
  const other = await request('/v1/me/saved-shops', 'B');
  assert.equal(other.status, 200);
  assert.deepEqual(await other.json(), { shops: [] });
  assert.equal((await request(first, 'B', 'PATCH', { nickname: 'Wrong home' })).status, 404);
  assert.equal((await request(first, 'A', 'PATCH', { nickname: 'Our home' })).status, 200);
  assert.equal((await request(first, 'A', 'DELETE')).status, 200);
});

test('runtime can save preferences and read catalog and history without operator access', async () => {
  const preference = '/v1/me/comparison-preferences/role-fixture';
  assert.equal((await request(preference, 'A', 'PUT', { basis: 'kg' })).status, 200);
  assert.deepEqual(await (await request(preference, 'B')).json(), { basis: null });
  assert.equal((await request(preference, 'A', 'DELETE')).status, 200);
  assert.equal((await request('/v1/me/price-observations', 'A')).status, 200);
  const product = '/v1/products/runtime-fixture-product';
  assert.equal((await request(product, 'A', 'PUT', { name: 'Runtime fixture product' })).status, 200);
  assert.equal((await request(product, 'A')).status, 200);
});

test('runtime cannot inspect credentials, write memberships, impersonate the guard, or delete canonical records', async () => {
  const { rows } = await runtime.query('SELECT current_user AS role');
  assert.equal(rows[0].role, 'cheapo_fixture_runtime');
  for (const sql of [
    'SELECT token_digest FROM cheapo.shopper_credential',
    'UPDATE cheapo.shopper_credential SET revoked_at = NULL',
    'UPDATE cheapo.household_membership SET revoked_at = NULL',
    'UPDATE cheapo.household SET id = id',
    'DELETE FROM cheapo.product',
    'SET ROLE cheapo_scope_guard',
  ]) {
    await assert.rejects(runtime.query(sql), { code: '42501' });
  }
  await operator.query('CREATE ROLE cheapo_fixture_visitor NOLOGIN');
  const { rows: [visitor] } = await operator.query(`
    SELECT has_function_privilege('cheapo_fixture_visitor',
      'cheapo.resolve_shopping_member(text, boolean)', 'EXECUTE') AS can_resolve
  `);
  assert.equal(visitor.can_resolve, false);
});
