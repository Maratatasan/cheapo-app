import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const fixtureBytes = await readFile(process.env.CHEAPO_POSTGRES_FIXTURE);
const digest = createHash('sha256').update(fixtureBytes).digest('hex');
assert.equal(digest, 'd2309e27ddcff166156693f491649814b61dbd1cd8b4ba99ebbfbad53cc30523');
const { seed, scenarios } = JSON.parse(fixtureBytes);

function psql() {
  return spawn('psql', [
    '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    '-h', process.env.CHEAPO_POSTGRES_SOCKET, '-p', '18765', '-d', 'postgres',
    '-U', process.env.CHEAPO_POSTGRES_USER,
  ], { stdio: 'pipe', env: { ...process.env, PGOPTIONS: '-c timezone=UTC -c statement_timeout=10000' } });
}

function finish(child) {
  let output = '';
  let errors = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { errors += chunk; });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(errors.trim() || `psql exited with status ${code}`));
    });
  });
}

function sql(statement) {
  const child = psql();
  const done = finish(child);
  child.stdin.end(statement + '\n');
  return done;
}

// Hex is used only to transport JSON through the psql script. Function names
// are selected by the harness; data is parsed by PostgreSQL from a hex literal.
function payload(value) {
  const hex = Buffer.from(JSON.stringify(value), 'utf8').toString('hex');
  return `convert_from(decode('${hex}', 'hex'), 'UTF8')::jsonb`;
}

function rows(output) {
  return output ? output.split('\n').map((line) => JSON.parse(line, (key, value) => (
    key === 'observedAt' ? new Date(value).toISOString() : value
  ))) : [];
}

async function call(operation, input) {
  return rows(await sql(`SELECT to_jsonb(result) FROM poc.${operation}(${payload(input)}) AS result;`));
}

async function one(operation, input) {
  const results = await call(operation, input);
  assert.ok(results.length <= 1);
  return results[0] ?? null;
}

// Hold an exclusive advisory lock until all worker sessions are waiting on it.
// Shared locks let them proceed concurrently on separate database connections.
async function race(operation, inputs) {
  const lockKey = 18765;
  const gate = psql();
  const closed = finish(gate);
  const ready = new Promise((resolve, reject) => {
    gate.stdout.once('data', resolve);
    gate.on('error', reject);
    gate.on('close', () => reject(new Error('race gate disconnected before acquiring the lock')));
  });
  gate.stdin.write(`SELECT pg_advisory_lock(${lockKey}) \\g /dev/null\nSELECT 'ready';\n`);
  let workers;
  try {
    await ready;
    workers = Promise.allSettled(inputs.map((input) => sql(`
      BEGIN;
      SELECT pg_advisory_xact_lock_shared(${lockKey}) \\g /dev/null
      SELECT to_jsonb(result) FROM poc.${operation}(${payload(input)}) AS result;
      COMMIT;
    `).then((output) => rows(output)[0])));

    const deadline = Date.now() + 5000;
    for (;;) {
      const waiting = await sql(`SELECT count(*) FROM pg_locks
        WHERE locktype = 'advisory' AND classid = 0 AND objid = ${lockKey} AND NOT granted;`);
      if (Number(waiting) === inputs.length) break;
      assert.ok(Date.now() < deadline, 'database worker connections did not reach the race gate');
      await delay(25);
    }
  } finally {
    gate.stdin.end();
    await closed;
    await workers;
  }
  return workers;
}

function assertConflict(error) {
  assert.match(error.message, /ERROR:\s+23505:/);
  return true;
}

async function check(scenario) {
  const { name, expected, input, inputs, repeat = 1, concurrentIdenticalCalls } = scenario;
  switch (name) {
    case 'storedObservations': {
      // The contract specifies ordering for latest and comparison, not history.
      const byId = (first, second) => first.id.localeCompare(second.id, 'en');
      assert.deepEqual((await call(name, scenario)).sort(byId), expected.toSorted(byId));
      return;
    }
    case 'listSavedShops':
    case 'compare':
      assert.deepEqual(await call(name, scenario), expected);
      return;
    case 'lookupBarcode':
    case 'latestPrice':
    case 'renameSavedShop':
    case 'correctObservation':
      for (let attempt = 0; attempt < repeat; attempt++) {
        assert.deepEqual(await one(name, scenario), expected);
      }
      return;
    case 'createProduct':
    case 'createObservation': {
      if (concurrentIdenticalCalls) {
        const results = await race(name, Array(concurrentIdenticalCalls).fill(input));
        for (const result of results) {
          if (result.status === 'rejected') throw result.reason;
          assert.deepEqual(result.value, expected);
        }
      } else {
        assert.deepEqual(await one(name, input), expected);
      }
      return;
    }
    case 'createProductConflict':
    case 'createObservationConflict':
      assert.equal(expected, 'conflict');
      await assert.rejects(one(name.replace(/Conflict$/, ''), input), assertConflict);
      return;
    case 'raceProductsWithSameBarcode': {
      const results = await race('createProduct', inputs);
      const winners = results.filter((result) => result.status === 'fulfilled');
      const losers = results.filter((result) => result.status === 'rejected');
      for (const loser of losers) assertConflict(loser.reason);
      const product = await one('lookupBarcode', { barcode: inputs[0].barcode });
      assert.deepEqual({
        created: winners.length,
        conflicts: losers.length,
        lookupMatchesWinner: winners.some(({ value }) => value.id === product?.id),
      }, expected);
      assert.deepEqual(winners[0].value, inputs.find(({ id }) => id === product.id));
      return;
    }
    case 'createDistinctObservationsConcurrently': {
      const results = await race('createObservation', inputs);
      const inserted = results.map((result) => {
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      });
      assert.deepEqual(inserted, expected);
      assert.deepEqual(await call('storedObservations', inputs[0]), expected);
      return;
    }
    case 'unlinkSavedShop':
      for (let attempt = 0; attempt < repeat; attempt++) {
        await call(name, scenario);
      }
      return;
    default:
      assert.fail(`Unknown fixture scenario: ${name}`);
  }
}

async function recordPlans(t) {
  const referenceProductId = seed.products[0].id;
  const compare = { referenceProductId, householdId: seed.households[0].id };
  const pair = { productId: referenceProductId, shopId: seed.shops[0].id };
  const explain = 'EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF, SUMMARY OFF)';
  const planQueries = `
    ${explain} SELECT * FROM poc.latestPrice(${payload(pair)});
    ${explain} SELECT * FROM poc.compare(${payload(compare)});
    ${explain} SELECT * FROM poc.compare(${payload({ ...compare, sameBrand: true, sameVariety: true })});
  `;
  t.diagnostic(await sql(`SELECT version();`));
  t.diagnostic('Frozen seed');
  for (const line of (await sql(`ANALYZE; ${planQueries}`)).split('\n')) t.diagnostic(line);
  t.diagnostic('Frozen seed plus 5,000 unrelated products and 21,000 older observations');
  const planSeed = await readFile(new URL('./plan-seed.sql', import.meta.url), 'utf8');
  for (const line of (await sql(`BEGIN; ${planSeed} ${planQueries} ROLLBACK;`)).split('\n')) {
    t.diagnostic(line);
  }
}

const plansOnly = process.env.CHEAPO_POSTGRES_PLAN === '1';
const suiteName = plansOnly ? 'PostgreSQL query plans' : 'PostgreSQL satisfies the frozen Cheapo database contract';
test(suiteName, async (t) => {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await sql(schema);
  await sql(await readFile(new URL('./seed.sql', import.meta.url), 'utf8'));
  await sql(`SELECT poc.loadFixture(${payload(seed)});`);
  if (plansOnly) {
    await recordPlans(t);
    return;
  }

  for (const [index, scenario] of scenarios.entries()) {
    await t.test(`${index + 1}. ${scenario.name}`, async () => check(scenario));
  }

  await t.test('Observation replay after correction preserves the correction', async () => {
    const create = scenarios.find(({ name }) => name === 'createObservation');
    const correction = scenarios.find(({ name }) => name === 'correctObservation');
    assert.deepEqual(await one('createObservation', create.input), correction.expected);
    await assert.rejects(one('createObservation', correction.expected), assertConflict);
  });
});
