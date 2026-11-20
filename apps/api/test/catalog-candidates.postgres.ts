import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

import type { CatalogCandidate } from '../catalog-candidates.ts';
import { credentialDigest } from '../credential.ts';
import { createLocalApi, createShoppingApi } from '../local-api.ts';

const host = process.env.CHEAPO_TEST_PG_SOCKET;
if (!host) throw Error('Run with pnpm --filter @cheapo/api test:postgres.');
const dbOptions = { host, port: Number(process.env.CHEAPO_TEST_PG_PORT), database: 'postgres', ssl: false };
const operator = new Pool({ ...dbOptions, user: 'cheapo_test' });
const runtime = new Pool({ ...dbOptions, user: 'cheapo_candidates_runtime' });
const api = createLocalApi(runtime);
const household = '00820000-0000-4000-8000-000000000001';
const otherHousehold = '00820000-0000-4000-8000-000000000002';
const shopper = '00820000-0000-4000-8000-000000000011';
const peer = '00820000-0000-4000-8000-000000000012';
const outsider = '00820000-0000-4000-8000-000000000013';
const token = (suffix: string) => `cheapo_${'r082'.repeat(10)}${suffix.repeat(3)}`;

before(async () => {
  await operator.query('CREATE ROLE cheapo_candidates_runtime LOGIN IN ROLE cheapo_api_runtime');
  await operator.query('INSERT INTO cheapo.household VALUES ($1), ($2)', [household, otherHousehold]);
  await operator.query('INSERT INTO cheapo.shopper VALUES ($1), ($2), ($3)', [shopper, peer, outsider]);
  await operator.query(`INSERT INTO cheapo.household_membership (household_id, shopper_id, revoked_at)
    VALUES ($1, $2, NULL), ($1, $3, NULL), ($4, $5, NULL), ($1, $5, statement_timestamp())`,
  [household, shopper, peer, otherHousehold, outsider]);
  for (const [suffix, home, member] of [
    ['A', household, shopper], ['B', household, peer], ['C', otherHousehold, outsider], ['D', household, outsider],
  ]) {
    await operator.query(`INSERT INTO cheapo.shopper_credential (token_digest, household_id, shopper_id, expires_at)
      VALUES ($1, $2, $3, statement_timestamp() + interval '1 day')`, [credentialDigest(token(suffix)), home, member]);
  }
  await operator.query(`INSERT INTO cheapo.product (id, name, brand, variety, pack, comparable_group_id, source_photo_ids) VALUES
    ('candidate-oats-500', 'Fixture Rolled-Oats', 'Example', 'Fine', '{"quantity":500,"unit":"g","label":"500g"}', 'oats', ARRAY['internal-photo']),
    ('candidate-oats-1000', 'Fixture Rolled Oats', 'Example', 'Fine', '{"quantity":1,"unit":"kg","label":"1 kg"}', 'oats', NULL),
    ('candidate-oats-multipack', 'Fixture Rolled Oats', 'Example', 'Fine', '{"quantity":500,"unit":"g","label":"2 × 250g"}', 'oats', NULL),
    ('candidate-oats-variety', 'Fixture Rolled Oats', 'Example', 'Coarse', '{"quantity":500,"unit":"g","label":"500g"}', 'oats', NULL),
    ('candidate-oats-brand', 'Fixture Rolled Oats', 'Other', 'Fine', '{"quantity":500,"unit":"g","label":"500g"}', 'oats', NULL)`);
  await operator.query(`INSERT INTO cheapo.price_observation
    (household_id, shopper_id, id, resource_id, product_id, source_product_id, source_product_name,
     captured_at, status, source_test_shop, recorded_in_error_reason, review)
    VALUES
      ($1, $2, 'local-observation-id', '00820000-0000-4000-8000-000000000020', NULL, 'private-draft-product',
       'Unlinked fixture tea', now(), 'complete', false, NULL,
       '{"productType":"Tea","brand":"Example","variety":"Decaf","packSize":"2 × 25g","shop":"Private branch name"}'),
      ($3, $4, 'local-observation-id', '00820000-0000-4000-8000-000000000021', NULL, NULL,
       'Unlinked fixture tea', now(), 'complete', false, NULL, '{"brand":"Other"}'),
      ($1, $2, 'hidden-draft', '00820000-0000-4000-8000-000000000022', NULL, NULL,
       'Unlinked fixture tea', now(), 'draft', false, NULL, NULL),
      ($1, $2, 'hidden-test-shop', '00820000-0000-4000-8000-000000000023', NULL, NULL,
       'Unlinked fixture tea', now(), 'complete', true, NULL, NULL),
      ($1, $2, 'hidden-error', '00820000-0000-4000-8000-000000000024', NULL, NULL,
       'Unlinked fixture tea', now(), 'complete', false, 'wrong tag', NULL),
      ($1, $2, 'known-catalog-link', '00820000-0000-4000-8000-000000000025', 'candidate-oats-500', NULL,
       'Unlinked fixture tea', now(), 'complete', false, NULL, NULL)`, [household, peer, otherHousehold, outsider]);
  await operator.query(`INSERT INTO cheapo.product (id, name)
    SELECT 'catalog-bounded-' || lpad(i::text, 2, '0'), 'Bounded Fixture Name' FROM generate_series(1, 15) AS i`);
  await operator.query(`INSERT INTO cheapo.product (id, name, pack)
    SELECT 'catalog-capped-' || lpad(i::text, 2, '0'), 'Capped Fixture Name', '{"quantity":1000,"unit":"g"}'::jsonb
    FROM generate_series(1, 52) AS i`);

});

after(async () => {
  await runtime.end();
  await operator.end();
});

function read(query: string, suffix = 'A', method = 'GET') {
  return api(new Request(`http://localhost/v1/product-candidates${query}`, {
    method, headers: { Authorization: `Bearer ${token(suffix)}` },
  }));
}

type CandidateReply = { candidates: CatalogCandidate[]; truncated: boolean };
const oats = '?name=%20fixture%20ROLLED---oats%20&brand=example&variety=fine&packSize=0.5%20kg';

test('returns the stable product and existing group only when known identity details are compatible', async () => {
  const response = await read(oats);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    candidates: [{ kind: 'catalog', product: {
      id: 'candidate-oats-500', name: 'Fixture Rolled-Oats', brand: 'Example', variety: 'Fine',
      pack: { quantity: 500, unit: 'g', label: '500g' }, comparableGroupId: 'oats',
    } }], truncated: false,
  });
});


test('shares eligible unlinked candidates inside the credential household using resource IDs', async () => {
  const filters = '?name=Unlinked%20fixture%20tea&packSize=2x25g';
  const result = {
    candidates: [{ kind: 'unlinked_observation', observationId: '00820000-0000-4000-8000-000000000020',
      details: { name: 'Unlinked fixture tea', productType: 'Tea', brand: 'Example', variety: 'Decaf',
        pack: { quantity: 50, unit: 'g', label: '2 × 25g' }, packSize: '2 × 25g' } }],
    truncated: false,
  };
  assert.deepEqual(await (await read(filters)).json(), result);
  assert.deepEqual(await (await read(filters, 'B')).json(), result);
  assert.deepEqual(await (await read('?name=Unlinked%20fixture%20tea&brand=Example', 'C')).json(),
    { candidates: [], truncated: false });
  const outsiderResults = await (await read('?name=Unlinked%20fixture%20tea', 'C')).json() as CandidateReply;
  assert.deepEqual(outsiderResults.candidates.map(candidate => {
    assert.equal(candidate.kind, 'unlinked_observation');
    return candidate.observationId;
  }),
    ['00820000-0000-4000-8000-000000000021']);
  assert.deepEqual(await (await read('?name=Unlinked%20fixture%20tea&packSize=50g')).json(),
    { candidates: [], truncated: false });
  assert.equal((await read(filters, 'D')).status, 403);
  assert.equal((await read(filters, 'Z')).status, 401);
});

test('limits results with stable ordering and distinguishes incomplete lists from a checked miss', async () => {
  const name = '?name=Bounded%20Fixture%20Name';
  const result = await (await read(name)).json() as CandidateReply;
  assert.equal(result.truncated, true);
  assert.deepEqual(result.candidates.map(candidate => {
    assert.equal(candidate.kind, 'catalog');
    return candidate.product.id;
  }), [
    'catalog-bounded-01', 'catalog-bounded-02', 'catalog-bounded-03', 'catalog-bounded-04',
    'catalog-bounded-05', 'catalog-bounded-06', 'catalog-bounded-07', 'catalog-bounded-08',
  ]);
  assert.deepEqual(await (await read(name)).json(), result);
  assert.deepEqual(await (await read('?name=No%20candidate')).json(), { candidates: [], truncated: false });
  assert.deepEqual(await (await read('?name=Capped%20Fixture%20Name&packSize=500g')).json(),
    { candidates: [], truncated: true });
});

test('rejects malformed reads and reports service failure explicitly', async () => {
  for (const query of ['', '?name=', '?name=--', '?name=oats&name=tea', '?name=oats&packSize=unknown',
    '?name=oats%00', '?name=oats&brand=%00', '?name=oats&householdId=caller', '?name=oats&limit=500']) {
    const response = await read(query);
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: 'invalid_product_search' });
  }
  const method = await read(oats, 'A', 'POST');
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('Allow'), 'GET');
  const failure = async () => { throw Error('database unavailable'); };
  const unavailable = await createShoppingApi({ query: failure, transaction: failure })(new Request(
    'http://localhost/v1/product-candidates' + oats, { headers: { Authorization: `Bearer ${token('A')}` } },
  ));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'catalog_unavailable' });
});
