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

async function request(letter: string, query = '', method = 'GET', body?: object) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return fetch(`http://127.0.0.1:${address.port}/v1/me/price-observations${query}`, {
    method,
    headers: { Authorization: `Bearer ${token(letter)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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
    id: restored.id, version: 1, sourceId: 'same-source-id', capturedAt, ownedByCurrentShopper: true,
    productId: null, sourceProductId: 'archived-product', productName: 'Original oats',
    shopId: null, sourceShopId: 'archived-shop', shopDisplayName: 'Old branch name',
    priceAmount: '2.0900', currency: 'GBP',
    review: { productName: 'Original oats', packSize: '500 g' },
    unitPrice: { amount: 0.418, unit: '100g' },
    photos: [{ role: 'original', width: 23, height: 17 }],
  });
  assert.deepEqual(await (await request('I')).json(), {
    ...result,
    observations: result.observations.map(observation => ({ ...observation, ownedByCurrentShopper: !observation.ownedByCurrentShopper })),
  });
  for (const privateId of [household, shopper, otherShopper]) assert(!JSON.stringify(result).includes(privateId));
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
  const remaining = second.observations.map(observation => ({ ...observation, ownedByCurrentShopper: !observation.ownedByCurrentShopper }));
  assert.deepEqual([...first.observations, ...remaining], unpaged.observations);
});

test('rejects unbounded, malformed, and caller-scoped page requests', async () => {
  for (const query of ['?limit=0', '?limit=51', '?limit=2&limit=1', '?cursor=garbage', '?householdId=caller']) {
    const response = await request('H', query);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_page' });
  }
});

const appendInput = {
  sourceId: 'phone-observation', capturedAt: '2026-11-03T08:03:02.654321+01:00',
  productId: 'append-oats', shopId: 'append-branch', shopDisplayName: 'Market when captured',
  review: { productName: 'Original oats', price: '3.45', currency: 'GBP', packSize: '500 g' },
  unitPrice: { amount: 0.69, unit: '100g' },
};

test('replays a concurrent price save and refuses to replace the original observation', async () => {
  await pool.query("INSERT INTO cheapo.shop (id, name) VALUES ('append-branch', 'Current market name')");
  await pool.query("INSERT INTO cheapo.household_saved_shop (household_id, shop_id) VALUES ($1, 'append-branch')", [household]);
  await pool.query("INSERT INTO cheapo.product (id, name) VALUES ('append-oats', 'Original oats')");
  const input = appendInput;
  const responses = await Promise.all([request('H', '', 'POST', input), request('H', '', 'POST', input)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
  const [first, repeated] = await Promise.all(responses.map(response => response.json() as Promise<{ id: string; sourceId: string; version: number }>));
  assert.deepEqual(first, repeated);
  assert.equal(first.sourceId, input.sourceId);
  assert.equal(first.version, 1);
  assert.match(first.id, /^[a-f0-9-]{36}$/);

  const conflict = await request('H', '', 'POST', { ...input, review: { ...input.review, price: '3.70' } });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: 'source_conflict' });

  const history = await (await request('I')).json() as HistoryBody;
  const saved = history.observations.filter(observation => observation.sourceId === input.sourceId);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, first.id);
  assert.equal(saved[0].shopDisplayName, 'Market when captured');
  assert.equal(saved[0].capturedAt, '2026-11-03T07:03:02.654321Z');
  assert.equal(saved[0].priceAmount, '3.45');
  assert.deepEqual(saved[0].unitPrice, input.unitPrice);
});


test('replays a lost acknowledgement after a later correction while leaving that correction intact', async () => {
  const input = { ...appendInput, sourceId: 'lost-save-acknowledgement', productId: null };
  const initial = await request('H', '', 'POST', input);
  assert.equal(initial.status, 201);
  const identity = await initial.json() as { id: string; sourceId: string; version: number };
  await pool.query(`UPDATE cheapo.price_observation
    SET record_version = 2, price_amount = 4.50, review = jsonb_set(review, '{price}', '"4.50"')
    WHERE resource_id = $1::uuid`, [identity.id]);

  const retried = await request('H', '', 'POST', input);
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), identity);
  const changed = await request('H', '', 'POST', { ...input, review: { ...input.review, price: '4.50' } });
  assert.equal(changed.status, 409);
  const history = await (await request('I')).json() as HistoryBody;
  const corrected = history.observations.find(observation => observation.id === identity.id);
  assert(corrected);
  assert.equal(corrected.priceAmount, '4.50');
  assert.equal(corrected.version, 2);
});

test('validates reviewed amounts and links and resolves every save to the enrolled household', async () => {
  const candidate = { ...appendInput, sourceId: 'second-dated-price' };
  for (const invalid of [
    { ...candidate, householdId: otherHousehold },
    { ...candidate, review: { ...candidate.review, currency: '£' } },
    { ...candidate, review: { ...candidate.review, price: '0' } },
    { ...candidate, review: { ...candidate.review, unitPrice: '0.82', unit: '100g' } },
  ]) {
    const response = await request('H', '', 'POST', invalid);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_price' });
  }
  assert.equal((await request('H', '', 'POST', { ...candidate, productId: 'missing-product' })).status, 422);
  assert.equal((await request('J', '', 'POST', candidate)).status, 422);
  assert.equal((await request('K', '', 'POST', candidate)).status, 403);
  assert.equal((await request('L', '', 'POST', candidate)).status, 401);

  const newPrice = await request('H', '', 'POST', { ...candidate, productId: null });
  assert.equal(newPrice.status, 201);
  const manual = (await (await request('I')).json() as HistoryBody).observations
    .find(observation => observation.sourceId === candidate.sourceId);
  assert(manual);
  assert.equal(manual.productId, null);
  assert.equal(manual.productName, candidate.review.productName);
});

test('allows an identical replay after unlinking the branch but requires a saved branch for a fresh price', async () => {
  await pool.query("DELETE FROM cheapo.household_saved_shop WHERE household_id = $1 AND shop_id = 'append-branch'", [household]);
  const replay = await request('H', '', 'POST', appendInput);
  assert.equal(replay.status, 200);
  assert.equal((await request('H', '', 'POST', { ...appendInput, sourceId: 'after-unlink' })).status, 422);
});

test('reopens one household observation with its selected crop and keeps other households out', async () => {
  const cropBox = { left: 1, top: 2, right: 9, bottom: 12 };
  await pool.query(`UPDATE cheapo.price_observation SET crop_box = $3::jsonb
    WHERE household_id = $1 AND shopper_id = $2 AND id = 'same-source-id'`, [household, shopper, cropBox]);
  await pool.query(`INSERT INTO cheapo.price_photo (household_id, shopper_id, observation_id, role, storage_key, sha256, byte_count, width, height)
    VALUES ($1, $2, 'same-source-id', 'crop', 'private-assets/crop.jpg', repeat('b',64), 51, 8, 10)`,
  [household, shopper]);
  const list = await (await request('H')).json() as HistoryBody;
  const legacy = list.observations.find(observation => observation.priceAmount === '2.0900');
  assert(legacy);
  const response = await request('I', `/${legacy.id}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    observation: { ...legacy, cropBox, selectedPhotoRole: 'crop', ownedByCurrentShopper: false },
  });
  assert.deepEqual(legacy.photos, [{ role: 'original', width: 23, height: 17 }, { role: 'crop', width: 8, height: 10 }]);
  assert.equal((await request('J', `/${legacy.id}`)).status, 404);
  assert.equal((await request('K', `/${legacy.id}`)).status, 403);
  assert.equal((await request('H', '/unknown-id')).status, 400);
  const hidden = await pool.query<{ resource_id: string }>(`SELECT resource_id FROM cheapo.price_observation
    WHERE household_id = $1 AND id IN ('hidden-draft', 'hidden-test-shop')`, [household]);
  assert.equal(hidden.rows.length, 2);
  for (const { resource_id } of hidden.rows) {
    assert.equal((await request('H', `/${resource_id}`)).status, 404);
  }
});

test('bounds exact product history and combines a canonical group with legacy reviewed categories', async () => {
  await pool.query("UPDATE cheapo.product SET comparable_group_id = 'porridge-group', product_type = 'Oats' WHERE id = 'append-oats'");
  await pool.query(`INSERT INTO cheapo.product (id, name, product_type, comparable_group_id)
    VALUES ('different-group-oats', 'Another oats pack', 'Oats', 'distinct-group')`);
  await pool.query(`UPDATE cheapo.price_observation SET review = review || '{"productType":" Oats "}'::jsonb
    WHERE household_id = $1 AND shopper_id = $2 AND id = 'same-source-id'`, [household, shopper]);
  await pool.query(`INSERT INTO cheapo.price_observation (household_id, shopper_id, id, product_id, captured_at, status, price_amount, currency)
    VALUES ($1, $2, 'distinct-group-price', 'different-group-oats', $3, 'complete', '4.40', 'GBP')`, [household, shopper, capturedAt]);

  const read = async (query: string) => {
    const response = await request('H', query);
    assert.equal(response.status, 200);
    return (await response.json() as HistoryBody).observations.map(item => item.sourceId);
  };
  assert.deepEqual(await read('?productId=append-oats'), ['phone-observation']);
  assert.deepEqual(await read('?comparableGroupId=porridge-group&productType=OATS&currency=GBP'),
    ['same-source-id', 'phone-observation']);
  assert.deepEqual(await read('?comparableGroupId=porridge-group'), ['phone-observation']);
  assert.deepEqual(new Set(await read('?productType=oats')), new Set(['same-source-id', 'phone-observation', 'distinct-group-price']));
  assert.deepEqual(await read('?comparableGroupId=porridge-group&productType=oats&currency=SEK'), []);
  assert.equal((await request('H', '?productId=append-oats&comparableGroupId=porridge-group')).status, 400);
});

test('keeps both versions and evidence when a second shopper corrects a price', async () => {
  const history = await (await request('H')).json() as HistoryBody;
  const original = history.observations.find(observation => observation.priceAmount === '2.0900');
  assert(original);
  const route = `/${original.id}`;
  const edit = {
    operationId: 'other-shopper-price-edit', expectedVersion: original.version, action: 'correct',
    review: { productName: 'Revised oats', price: '2.39', currency: 'GBP', productType: 'Oats', packSize: '500 g' },
    unitPrice: { amount: 0.478, unit: '100g' },
  };
  assert.equal((await request('J', route, 'PATCH', edit)).status, 404);
  assert.equal((await request('K', route, 'PATCH', edit)).status, 403);

  const edits = await Promise.all([request('I', route, 'PATCH', edit), request('I', route, 'PATCH', edit)]);
  assert.deepEqual(edits.map(response => response.status), [200, 200]);
  const [applied, duplicate] = await Promise.all(edits.map(response => response.json() as Promise<{ observation: PriceObservation }>));
  assert.deepEqual(duplicate, applied);
  assert.equal(applied.observation.id, original.id);
  assert.equal(applied.observation.sourceId, original.sourceId);
  assert.equal(applied.observation.sourceProductId, original.sourceProductId);
  assert.equal(applied.observation.version, 2);
  assert.equal(applied.observation.priceAmount, '2.39');
  assert.equal(applied.observation.productName, 'Revised oats');
  assert.deepEqual(applied.observation.photos, original.photos);

  const stale = await request('H', route, 'PATCH', { ...edit, operationId: 'stale-price-edit' });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: 'version_conflict', currentVersion: 2, current: { ...applied.observation, ownedByCurrentShopper: true } });
  const reuse = await request('I', route, 'PATCH', { ...edit, review: { ...edit.review, price: '2.66' } });
  assert.equal(reuse.status, 409);
  assert.deepEqual(await reuse.json(), { error: 'operation_conflict' });

  const { rows } = await pool.query(`SELECT actor_shopper_id, version,
    before_state->>'priceAmount' AS before_price, after_state->>'priceAmount' AS after_price
    FROM cheapo.price_observation_revision WHERE resource_id = $1::uuid`, [original.id]);
  assert.deepEqual(rows, [{ actor_shopper_id: otherShopper, version: 2, before_price: '2.0900', after_price: '2.39' }]);

  const competing = history.observations.find(observation => observation.priceAmount === '3.37');
  assert(competing);
  const contested = `/${competing.id}`;
  const revision = { ...edit, expectedVersion: competing.version };
  const rivals = await Promise.all([
    request('H', contested, 'PATCH', { ...revision, operationId: 'competing-edit-one' }),
    request('I', contested, 'PATCH', { ...revision, operationId: 'competing-edit-two', review: { ...revision.review, price: '2.18' } }),
  ]);
  assert.deepEqual(rivals.map(response => response.status).sort(), [200, 409]);
  const rejected = await rivals.find(response => response.status === 409)?.json() as { currentVersion: number };
  assert.equal(rejected.currentVersion, 2);
});

test('records an error with a reason, preserves direct evidence, and allows a versioned undo', async () => {
  const history = await (await request('H')).json() as HistoryBody;
  const source = history.observations.find(observation => observation.sourceProductId === 'archived-product');
  assert(source);
  assert.equal(source.priceAmount, '2.39');
  const route = `/${source.id}`;
  const mark = { operationId: 'mark-slip', action: 'record_in_error', expectedVersion: source.version, reason: 'Wrong shelf label' };
  assert.equal((await request('H', route, 'PATCH', { ...mark, reason: '  ' })).status, 400);

  const marked = await request('H', route, 'PATCH', mark);
  assert.equal(marked.status, 200);
  const markedBody = await marked.json() as { observation: PriceObservation };
  assert.equal(markedBody.observation.version, 3);
  assert.equal(markedBody.observation.recordedInErrorReason, mark.reason);
  assert.deepEqual(markedBody.observation.photos, source.photos);

  const comparison = await (await request('I', '?productType=oats')).json() as HistoryBody;
  assert(!comparison.observations.some(observation => observation.id === source.id));
  const ordinary = await (await request('I')).json() as HistoryBody;
  assert(!ordinary.observations.some(observation => observation.id === source.id));
  const recovery = await (await request('I', '?includeRecordedInError=true')).json() as HistoryBody;
  assert.equal(recovery.observations.find(observation => observation.id === source.id)?.recordedInErrorReason, mark.reason);
  assert.equal((await request('I', '?productType=oats&includeRecordedInError=true')).status, 400);
  assert.deepEqual(await (await request('I', route)).json(), {
    observation: { ...markedBody.observation, ownedByCurrentShopper: false },
  });

  const undo = { operationId: 'undo-corrected-label', action: 'undo_recorded_in_error', expectedVersion: 3 };
  assert.equal((await request('I', route, 'PATCH', { ...undo, expectedVersion: 2 })).status, 409);
  const restored = await request('I', route, 'PATCH', undo);
  assert.equal(restored.status, 200);
  const restoredBody = await restored.json() as { observation: PriceObservation };
  assert.equal(restoredBody.observation.version, 4);
  assert.equal(restoredBody.observation.recordedInErrorReason, undefined);
  assert.deepEqual(restoredBody.observation.photos, source.photos);
  assert.deepEqual(await (await request('H', route, 'PATCH', mark)).json(), markedBody);
  assert.deepEqual(await (await request('H', route)).json(), {
    observation: { ...restoredBody.observation, ownedByCurrentShopper: true },
  });

  await pool.query('UPDATE cheapo.shopper_credential SET revoked_at = statement_timestamp() WHERE token_digest = $1',
    [createHash('sha256').update(token('I')).digest('hex')]);
  assert.equal((await request('I', route, 'PATCH', undo)).status, 401);
});
