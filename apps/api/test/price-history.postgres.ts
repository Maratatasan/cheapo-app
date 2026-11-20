import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

import { createLocalApi } from '../local-api.ts';
import type { PriceObservation } from '../price-history.ts';
import { localHttpServer } from '../server.ts';

const host = process.env.CHEAPO_TEST_PG_SOCKET;
if (!host) throw new Error('Run with pnpm --filter @cheapo/api test:postgres.');
const pool = new Pool({
  host, port: Number(process.env.CHEAPO_TEST_PG_PORT), user: 'cheapo_test', database: 'postgres', ssl: false,
});
const server = localHttpServer(createLocalApi(pool));
const household = '00000000-0000-4000-8000-000000008800';
const otherHousehold = '00000000-0000-4000-8000-000000008801';
const shopper = '00000000-0000-4000-8000-000000008810';
const otherShopper = '00000000-0000-4000-8000-000000008811';
const visitor = '00000000-0000-4000-8000-000000008812';
type HistoryBody = { observations: PriceObservation[]; nextCursor: string | null };
const capturedAt = '2026-11-05T10:20:30.123456Z';
const token = (letter: string) => `cheapo_${letter.repeat(43)}`;

before(async () => {
  await pool.query('INSERT INTO cheapo.household VALUES ($1), ($2)', [household, otherHousehold]);
  await pool.query('INSERT INTO cheapo.shopper VALUES ($1), ($2), ($3)', [shopper, otherShopper, visitor]);
  await pool.query(`INSERT INTO cheapo.household_membership (household_id, shopper_id, revoked_at)
    VALUES ($1, $2, NULL), ($1, $3, NULL), ($4, $5, NULL), ($1, $5, statement_timestamp())`,
  [household, shopper, otherShopper, otherHousehold, visitor]);
  for (const [letter, home, member] of [
    ['H', household, shopper], ['I', household, otherShopper],
    ['J', otherHousehold, visitor], ['K', household, visitor],
  ]) {
    await pool.query(`INSERT INTO cheapo.shopper_credential (token_digest, household_id, shopper_id, expires_at)
      VALUES ($1, $2, $3, statement_timestamp() + interval '1 day')`,
    [createHash('sha256').update(token(letter)).digest('hex'), home, member]);
  }
  await pool.query(`INSERT INTO cheapo.price_observation
    (household_id, shopper_id, id, source_shop_id, source_product_id, source_product_name,
      shop_display_name, captured_at, status, price_amount, currency, source_test_shop, review, unit_price)
    VALUES
      ($1, $2, 'same-source-id', 'archived-shop', 'archived-product', 'Original oats', 'Old branch name',
        $4, 'complete', '2.0900', 'GBP', false, '{"productName":"Original oats","packSize":"500 g"}', '{"amount":0.418,"unit":"100g"}'),
      ($1, $3, 'same-source-id', NULL, NULL, 'Another observation', NULL, $4, 'complete', '3.37', 'GBP', NULL, NULL, NULL),
      ($1, $2, 'hidden-draft', NULL, NULL, NULL, NULL, $4, 'draft', NULL, NULL, false, NULL, NULL),
      ($1, $2, 'hidden-test-shop', NULL, NULL, NULL, NULL, $4, 'complete', '4.98', 'GBP', true, NULL, NULL),
      ($5, $6, 'outside-household', NULL, NULL, NULL, NULL, $4, 'complete', '9.14', 'GBP', false, NULL, NULL)`,
  [household, shopper, otherShopper, capturedAt, otherHousehold, visitor]);
  await pool.query(`INSERT INTO cheapo.price_photo (household_id, shopper_id, observation_id, role, storage_key, sha256, byte_count, width, height)
    VALUES ($1, $2, 'same-source-id', 'original', 'private-assets/original.jpg', repeat('a',64), 82, 23, 17)`,
  [household, shopper]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
});

async function request(letter: string, query = '') {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return fetch(`http://127.0.0.1:${address.port}/v1/me/price-observations${query}`, {
    headers: { Authorization: `Bearer ${token(letter)}` },
  });
}

test('shares complete household prices with exact legacy evidence and keeps each resource distinct', async () => {
  const response = await request('H');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const result = await response.json() as HistoryBody;
  assert.equal(result.nextCursor, null);
  assert.equal(result.observations.length, 2);
  assert.deepEqual(result.observations.map(observation => observation.sourceId),
    ['same-source-id', 'same-source-id']);
  assert.notEqual(result.observations[0].id, result.observations[1].id);
  const restored = result.observations.find(observation => observation.priceAmount === '2.0900');
  assert(restored);
  assert.match(restored.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(restored, {
    id: restored.id, version: 1, sourceId: 'same-source-id', capturedAt,
    productId: null, sourceProductId: 'archived-product', productName: 'Original oats',
    shopId: null, sourceShopId: 'archived-shop', shopDisplayName: 'Old branch name',
    priceAmount: '2.0900', currency: 'GBP',
    review: { productName: 'Original oats', packSize: '500 g' },
    unitPrice: { amount: 0.418, unit: '100g' },
    photos: [{ role: 'original', width: 23, height: 17 }],
  });
  assert.deepEqual(await (await request('I')).json(), result);
  const other = await (await request('J')).json() as HistoryBody;
  assert.deepEqual(other.observations.map(observation => observation.sourceId), ['outside-household']);
  assert.equal((await request('K')).status, 403);
  assert.equal((await request('L')).status, 401);
});

test('pages a tie in capture time without repeating or dropping an observation', async () => {
  const first = await (await request('H', '?limit=1')).json() as HistoryBody;
  assert(first.nextCursor);
  assert.equal(first.observations.length, 1);
  const second = await (await request('I', `?limit=1&cursor=${first.nextCursor}`)).json() as HistoryBody;
  assert.equal(second.nextCursor, null);
  assert.equal(second.observations.length, 1);
  assert.notEqual(first.observations[0].id, second.observations[0].id);
  const unpaged = await (await request('H')).json() as HistoryBody;
  assert.deepEqual([...first.observations, ...second.observations], unpaged.observations);
});

test('rejects unbounded, malformed, and caller-scoped page requests', async () => {
  for (const query of ['?limit=0', '?limit=51', '?limit=2&limit=1', '?cursor=garbage', '?householdId=caller']) {
    const response = await request('H', query);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_page' });
  }
});
