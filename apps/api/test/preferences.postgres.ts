import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

import { createLocalApi } from '../local-api.ts';
import { postgresPreferences } from '../postgres.ts';
import { createPreferencesHandler } from '../preferences.ts';
import { localHttpServer } from '../server.ts';

const host = process.env.CHEAPO_TEST_PG_SOCKET;
if (!host) throw new Error('Run this test with pnpm --filter @cheapo/api test:postgres.');
const connection = { host, port: Number(process.env.CHEAPO_TEST_PG_PORT), user: 'cheapo_test', database: 'postgres', ssl: false };
const pool = new Pool(connection);
const household = '00000000-0000-4000-8000-000000000001';
const otherHousehold = '00000000-0000-4000-8000-000000000002';
const alex = '00000000-0000-4000-8000-000000000011';
const sam = '00000000-0000-4000-8000-000000000012';
const robin = '00000000-0000-4000-8000-000000000013';
const token = (letter: string) => `cheapo_${letter.repeat(43)}`;
const server = localHttpServer(createLocalApi(pool));

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
  return requestWithToken(token(letter), group, method, basis, target);
}

async function requestWithToken(credential: string, group: string, method = 'GET', basis?: string, target = server) {
  const address = target.address();
  assert(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/me/comparison-preferences/${encodeURIComponent(group)}`, {
    method,
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: basis === undefined ? undefined : JSON.stringify({ basis }),
  });
  return { status: response.status, body: await response.json() };
}

async function savedShopRequest(letter: string, suffix = '', method = 'GET', body?: object) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  const route = suffix === '/selection' ? '/v1/me/current-shop' : `/v1/me/saved-shops${suffix}`;
  const response = await fetch(`http://127.0.0.1:${address.port}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token(letter)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('keeps saved shop names and current selection within their access scope', async () => {
  const id = 'scoped-test-branch';
  await pool.query("INSERT INTO cheapo.shop (id, name) VALUES ($1, 'High Street')", [id]);
  await pool.query(`INSERT INTO cheapo.household_saved_shop VALUES ($1, $2, 'Our shop'), ($3, $2, 'Other name')`,
    [household, id, otherHousehold]);
  await pool.query('INSERT INTO cheapo.shopper_current_shop VALUES ($1, $2, $3)', [household, alex, id]);
  assert.deepEqual(await savedShopRequest('A'), {
    status: 200,
    body: { shops: [{ id, name: 'High Street', nickname: 'Our shop' }], currentShop: { id, name: 'High Street', nickname: 'Our shop' } },
  });
  assert.deepEqual(await savedShopRequest('B'), {
    status: 200,
    body: { shops: [{ id, name: 'High Street', nickname: 'Our shop' }] },
  });
  assert.deepEqual(await savedShopRequest('C'), {
    status: 200,
    body: { shops: [{ id, name: 'High Street', nickname: 'Other name' }] },
  });
  assert.equal((await savedShopRequest('D')).status, 403);
  assert.equal((await savedShopRequest('E')).status, 401);
  await pool.query('DELETE FROM cheapo.shopper_current_shop WHERE shop_id = $1', [id]);
  await pool.query('DELETE FROM cheapo.household_saved_shop WHERE shop_id = $1', [id]);
  await pool.query('DELETE FROM cheapo.shop WHERE id = $1', [id]);
});

test('replays a shop save, shares nickname edits inside the household, and unlinks without losing history', async () => {
  const id = 'shop-lifecycle';
  const location = { latitude: 51.14, longitude: -0.18 };
  const name = 'Market Road';
  const address = '20 Market Road';
  const original = { name, address, location, nickname: 'Our shop' };
  const item = `/${id}`;
  const expected = { id, ...original };
  const primary = { status: 200, body: { shops: [expected], currentShop: expected } };
  assert.deepEqual(await Promise.all([
    savedShopRequest('A', item, 'PUT', { ...original, select: true }),
    savedShopRequest('A', item, 'PUT', { ...original, select: true }),
  ]), [primary, primary]);
  assert.equal((await savedShopRequest('C', item, 'PATCH', { nickname: 'Illegal edit' })).status, 404);
  assert.equal((await savedShopRequest('C', '/selection', 'PUT', { shopId: id })).status, 404);

  const householdEdit = { ...expected, nickname: 'Our new name' };
  assert.deepEqual(await savedShopRequest('B', item, 'PATCH', { nickname: householdEdit.nickname }),
    { status: 200, body: { shops: [householdEdit] } });
  assert.deepEqual(await savedShopRequest('A', item, 'PUT', original),
    { status: 200, body: { shops: [householdEdit], currentShop: householdEdit } });

  const otherShop = { ...expected, nickname: 'Their shop' };
  assert.deepEqual(await savedShopRequest('C', item, 'PUT', { name: 'Untrusted rename', nickname: otherShop.nickname, select: true }),
    { status: 200, body: { shops: [otherShop], currentShop: otherShop } });
  assert.equal((await savedShopRequest('B', '/selection', 'PUT', { shopId: id })).status, 200);
  await pool.query(`INSERT INTO cheapo.price_observation
    (household_id, shopper_id, id, shop_id, shop_display_name, captured_at, status, price_amount, currency)
    VALUES ($1, $2, 'shop-lifecycle-price', $3, 'Earlier shop name', statement_timestamp(), 'complete', 2.5, 'GBP')`,
  [household, alex, id]);
  assert.deepEqual(await savedShopRequest('A', item, 'DELETE'), { status: 200, body: { shops: [] } });
  assert.deepEqual(await savedShopRequest('A', item, 'DELETE'), { status: 200, body: { shops: [] } });
  assert.deepEqual(await savedShopRequest('B'), { status: 200, body: { shops: [] } });
  assert.deepEqual(await savedShopRequest('C'), { status: 200, body: { shops: [otherShop], currentShop: otherShop } });
  const { rows } = await pool.query("SELECT shop_id, shop_display_name FROM cheapo.price_observation WHERE id = 'shop-lifecycle-price'");
  assert.deepEqual(rows, [{ shop_id: id, shop_display_name: 'Earlier shop name' }]);
});

test('validates shop data and never links branches by address alone', async () => {
  const address = '22 Market Road';
  for (const id of ['separate-branch-one', 'separate-branch-two']) {
    assert.equal((await savedShopRequest('B', `/${id}`, 'PUT', { name: 'Market Road', address })).status, 200);
  }
  const snapshot = await savedShopRequest('B');
  assert.deepEqual(snapshot, { status: 200, body: { shops: [
    { id: 'separate-branch-one', name: 'Market Road', address },
    { id: 'separate-branch-two', name: 'Market Road', address },
  ] } });
  assert.equal((await savedShopRequest('B', '/invalid-branch', 'PUT', { name: ' ', location: { latitude: 99, longitude: 0 } })).status, 400);
  assert.equal((await savedShopRequest('B', '/separate-branch-one', 'PATCH', { address: ' ' })).status, 400);
  assert.equal((await savedShopRequest('B', '/separate-branch-one', 'PATCH', { name: null })).status, 400);
  assert.deepEqual(await savedShopRequest('B'), snapshot);
});

test('retains imported test-shop provenance across read and edit', async () => {
  const id = 'imported-test-shop';
  await pool.query("INSERT INTO cheapo.shop (id, name) VALUES ($1, 'Field fixture')", [id]);
  await pool.query("INSERT INTO cheapo.household_saved_shop (household_id, shop_id, source_test_shop) VALUES ($1, $2, true)",
    [otherHousehold, id]);
  const record = { id, name: 'Field fixture', nickname: 'My fixture', testShop: true };
  const update = await savedShopRequest('C', `/${id}`, 'PATCH', { nickname: record.nickname });
  assert.equal(update.status, 200);
  assert.ok(update.body && typeof update.body === 'object' && 'shops' in update.body && Array.isArray(update.body.shops));
  assert.deepEqual(update.body.shops.find(shop => shop.id === id), record);
});

async function catalogRequest(letter: string, suffix: string, method = 'GET', product?: object) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/products${suffix}`, {
    method,
    headers: { Authorization: `Bearer ${token(letter)}`, 'Content-Type': 'application/json' },
    body: product === undefined ? undefined : JSON.stringify(product),
  });
  return { status: response.status, body: await response.json() };
}

test('looks up the same canonical product from UPC, EAN, canonical GTIN and product ID', async () => {
  const id = 'catalog-oats';
  const input = { name: ' Oats ', productType: 'Cereal', barcode: '012345678905', pack: { quantity: 1, unit: 'kg' } };
  const expected = { status: 200, body: { product: { ...input, id, name: 'Oats', barcode: '00012345678905' } } };
  assert.deepEqual(await catalogRequest('A', '?gtin=012345678905'), { status: 200, body: { product: null } });
  assert.deepEqual(await catalogRequest('A', `/${id}`, 'PUT', input), expected);
  for (const code of ['012345678905', '0012345678905', '00012345678905']) {
    assert.deepEqual(await catalogRequest('B', `?gtin=${code}`), expected);
  }
  assert.deepEqual(await catalogRequest('B', `/${id}`), expected);
  assert.equal((await catalogRequest('E', `/${id}`)).status, 401);
  assert.equal((await catalogRequest('D', '?gtin=012345678905')).status, 403);
});

test('replays only identical product creation and reports exact ID or barcode collisions', async () => {
  const id = 'catalog-replay';
  const input = { name: 'Same name', barcode: '96385074', productType: 'Cereal', pack: { quantity: 2, unit: 'kg' } };
  const product = { ...input, id, barcode: '00000096385074' };
  const exact = { status: 200, body: { product } };
  const conflict = { status: 409, body: { error: 'product_conflict', product } };
  assert.deepEqual(await Promise.all([
    catalogRequest('A', `/${id}`, 'PUT', input),
    catalogRequest('B', `/${id}`, 'PUT', { ...input, barcode: product.barcode, pack: { unit: 'kg', quantity: 2 } }),
  ]), [exact, exact]);
  assert.deepEqual(await catalogRequest('A', `/${id}`, 'PUT', { ...input, name: 'A corrected name' }), conflict);
  assert.deepEqual(await catalogRequest('B', `/${id}`, 'PUT', { ...input, pack: { ...input.pack, quantity: 3 } }), conflict);
  const otherBarcode = '4006381333931';
  assert.deepEqual(await catalogRequest('B', `/${id}`, 'PUT', { ...input, barcode: otherBarcode }), conflict);
  assert.deepEqual(await catalogRequest('B', '/other-catalog-id', 'PUT', input), conflict);

  const other = await catalogRequest('B', '/another-product', 'PUT', { ...input, barcode: otherBarcode });
  assert.deepEqual(other, {
    status: 200, body: { product: { ...input, id: 'another-product', barcode: '04006381333931' } },
  });
  assert.deepEqual(await catalogRequest('B', `/${id}`), exact);
});

test('rejects invalid barcodes and omits private import fields from canonical product reads', async () => {
  assert.equal((await catalogRequest('A', '?gtin=012345678906')).status, 400);
  assert.equal((await catalogRequest('A', '/bad', 'PUT', { name: 'Oats', barcode: '012345678906', productType: 'Cereal' })).status, 400);
  assert.equal((await catalogRequest('A', '/bad', 'PUT', { name: 'Oats', barcode: '012345678905' })).status, 400);
  const id = 'catalog-imported';
  await pool.query(`INSERT INTO cheapo.product (id, name, source_photo_ids)
    VALUES ($1, 'Imported product', ARRAY['private-import-fixture'])`, [id]);
  assert.deepEqual(await catalogRequest('C', `/${id}`), {
    status: 200, body: { product: { id, name: 'Imported product' } },
  });
});

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

function deviceCommand(...args: string[]) {
  return spawnSync(process.execPath, ['operator/device-credential.ts', ...args], {
    encoding: 'utf8',
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PGHOST: host, PGPORT: String(connection.port), PGUSER: 'cheapo_test', PGDATABASE: 'postgres' },
  });
}

function runDeviceCommand(...args: string[]): string {
  const result = deviceCommand(...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('issues separate credentials through the operator command and revokes only the selected phone', async () => {
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  async function issuePhone(shopper = alex, home = household) {
    const output = runDeviceCommand('issue', home, shopper, expiresAt);
    const { credentialId, deliveryFile } = JSON.parse(output);
    try {
      assert.equal((await stat(deliveryFile)).mode & 0o777, 0o600);
      assert.equal((await stat(dirname(deliveryFile))).mode & 0o777, 0o700);
      const credential = (await readFile(deliveryFile, 'utf8')).trimEnd();
      assert.match(credential, /^cheapo_[A-Za-z0-9_-]{43}$/);
      assert.equal(output.includes(credential), false, 'Token is absent from command output');
      const { rows } = await pool.query('SELECT * FROM cheapo.shopper_credential WHERE id = $1', [credentialId]);
      assert.equal(rows[0].token_digest, createHash('sha256').update(credential).digest('hex'));
      assert.equal(rows[0].shopper_id, shopper);
      assert.equal(rows[0].household_id, home);
      assert.equal(new Date(rows[0].expires_at).toISOString(), expiresAt);
      assert.equal(JSON.stringify(rows).includes(credential), false, 'Token is absent from persisted metadata');
      return { credential, credentialId };
    } finally {
      await rm(dirname(deliveryFile), { recursive: true });
    }
  }

  const first = await issuePhone();
  const second = await issuePhone();
  const otherHouse = await issuePhone(robin, otherHousehold);
  assert.equal(first.credential === second.credential, false, 'Each phone receives a unique token');
  assert.notEqual(first.credentialId, second.credentialId);
  const group = 'operator test product group';
  assert.deepEqual(await requestWithToken(first.credential, group, 'PUT', 'wash'), ok('wash'));
  assert.deepEqual(await requestWithToken(otherHouse.credential, group), ok(null));
  assert.deepEqual(await requestWithToken(second.credential, group), ok('wash'));

  runDeviceCommand('revoke', first.credentialId);
  runDeviceCommand('revoke', first.credentialId);
  assert.deepEqual(await requestWithToken(first.credential, group), {
    status: 401, body: { error: 'unauthenticated' },
  });
  assert.deepEqual(await requestWithToken(second.credential, group), ok('wash'));
});

test('denies issuing credentials for inactive or unrelated memberships and past expiry', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  for (const args of [[household, robin, future], [otherHousehold, alex, future], [household, alex, past]]) {
    const result = deviceCommand('issue', ...args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /requires an active membership and a future expiry/);
  }
});

async function shopCandidates(letter: string, query: string) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  const search = new URLSearchParams({ query });
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/shops?${search}`, {
    headers: { Authorization: `Bearer ${token(letter)}` },
  });
  return { status: response.status, body: await response.json() };
}

test('finds canonical branch candidates without reading household nicknames or linking shops', async () => {
  const branch = { id: 'candidate-market-hall', name: 'Market Hall', address: '12 Square Lane',
    location: { latitude: 51.14, longitude: -0.18 } };
  await pool.query('INSERT INTO cheapo.shop (id, name, address, location) VALUES ($1, $2, $3, $4)',
    [branch.id, branch.name, branch.address, branch.location]);
  await pool.query(`INSERT INTO cheapo.household_saved_shop (household_id, shop_id, nickname)
    VALUES ($1, $2, 'Private Fish Shop')`, [otherHousehold, branch.id]);
  const expected = { status: 200, body: { shops: [branch] } };
  const before = await savedShopRequest('A');
  assert.deepEqual(await shopCandidates('A', ' market HALL '), expected);
  assert.deepEqual(await shopCandidates('A', 'square lane'), expected);
  assert.deepEqual(await shopCandidates('A', 'Private Fish Shop'), { status: 200, body: { shops: [] } });
  assert.equal((await shopCandidates('D', 'Market Hall')).status, 403);
  assert.equal((await shopCandidates('F', 'Market Hall')).status, 401);
  assert.deepEqual(await savedShopRequest('A'), before);
});

test('caps candidate results and treats searches as literal text', async () => {
  await pool.query(`INSERT INTO cheapo.shop (id, name)
    SELECT 'candidate-cap-' || lpad(n::text, 2, '0'), 'Fixture Market ' || lpad(n::text, 2, '0')
    FROM generate_series(1, 22) AS n`);
  assert.deepEqual(await shopCandidates('A', 'Fixture Market'), {
    status: 200,
    body: { shops: Array.from({ length: 20 }, (_, index) => {
      const suffix = String(index + 1).padStart(2, '0');
      return { id: `candidate-cap-${suffix}`, name: `Fixture Market ${suffix}` };
    }) },
  });
  assert.deepEqual(await shopCandidates('A', '%%'), { status: 200, body: { shops: [] } });
  assert.equal((await shopCandidates('A', ' ')).status, 400);
});
