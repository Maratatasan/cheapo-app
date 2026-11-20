import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import { localImportPhotos } from '../local-import-photos.ts';
import { planShoppingImport } from '../shopping-import-plan.ts';
import { applyShoppingImport } from '../shopping-import.ts';

const host = process.env.CHEAPO_TEST_PG_SOCKET;
if (!host) throw new Error('Run with pnpm --filter @cheapo/api test:postgres.');
const pool = new Pool({ host, port: Number(process.env.CHEAPO_TEST_PG_PORT), user: 'cheapo_test', database: 'postgres', ssl: false });
const householdId = '00000000-0000-4000-8000-000000000100';
const shopperId = '00000000-0000-4000-8000-000000000200';
const owner = { householdId, shopperId };
const otherHouseholdId = '00000000-0000-4000-8000-000000000300';
const otherOwner = { householdId: otherHouseholdId, shopperId };
const product = { id: 'demo-oats', name: 'Example Oats', barcode: '00012345600012' };
const shop = { id: 'branch-example', name: 'Example Market', nickname: 'Private nickname', testShop: false, displayName: 'Private nickname' };
const original = { path: 'photos/1/original.jpg', width: 5, height: 5, mimeType: 'image/jpeg' };
const crop = { ...original, path: 'photos/1/crop.jpg', width: 3, height: 3 };
const record = {
  id: 'price-test-first', productId: product.id, capturedAt: '2026-01-08T12:30:00.123Z',
  productName: 'Example Oats', status: 'complete', testShop: false,
  shop: { id: shop.id, displayName: 'Original observation shop name' },
  review: { price: '3.19', currency: 'GBP', packSize: ' 500 g ' },
  unitPrice: { amount: 0.638, unit: '100g' }, cropBox: null,
  photos: { original, crop, selectedPath: crop.path },
};
const earlier = {
  ...record, id: 'price-test-earlier', capturedAt: '2026-01-05T09:30:00.456Z',
  review: { price: '2.95', currency: 'GBP' }, photos: null,
};
const unlinked = {
  ...record, id: 'price-test-unlinked', capturedAt: '2026-01-08T12:31:00.000Z', status: 'draft', productId: undefined, testShop: true,
  shop: { id: 'removed-shop', displayName: 'Closed branch' }, review: { price: '', currency: '$' }, photos: null,
};
const fixture = {
  version: 3, source: { appName: 'Local fixture', appVersion: '1.0.0', androidVersionCode: 1, platform: 'android' },
  exportedAt: '2026-01-09T00:00:00.000Z', currentShopId: shop.id, savedShops: [shop],
  catalog: {
    legacyProducts: [], originalProducts: [product],
    corrections: [{ revision: 1, previous: product.barcode, product: { ...product, barcode: '00012345600029' } }],
  },
  records: [record, earlier, unlinked],
};
const directory = await mkdtemp(join(tmpdir(), 'cheapo-shopping-restore-'));
const objects = await mkdtemp(join(tmpdir(), 'cheapo-shopping-objects-'));
const ensurePhoto = await localImportPhotos(directory, objects);

async function plan(manifest: object = fixture) {
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return planShoppingImport(directory);
}

before(async () => {
  await pool.query('INSERT INTO cheapo.household VALUES ($1), ($2)', [householdId, otherHouseholdId]);
  await pool.query('INSERT INTO cheapo.shopper VALUES ($1)', [shopperId]);
  await pool.query(`INSERT INTO cheapo.household_membership (household_id, shopper_id)
    VALUES ($1, $2), ($3, $2)`, [householdId, shopperId, otherHouseholdId]);
  await mkdir(join(directory, 'photos/1'), { recursive: true });
  await writeFile(join(directory, original.path), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]));
  await writeFile(join(directory, crop.path), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x02]));
});

after(async () => {
  await pool.end();
  await rm(directory, { recursive: true, force: true });
  await rm(objects, { recursive: true, force: true });
});

test('restores prices, catalog history, private shop state, and both photo references with repeat-safe reconciliation', async () => {
  const snapshot = await plan();
  const receipt = await applyShoppingImport(pool, owner, snapshot, ensurePhoto);
  const { stdout } = await promisify(execFile)(process.execPath,
    ['import-shopping-local.ts', directory, objects, householdId, shopperId], {
      env: { ...process.env, PGHOST: host, PGPORT: process.env.CHEAPO_TEST_PG_PORT, PGDATABASE: 'postgres', PGUSER: 'cheapo_test' },
    });
  assert.deepEqual(JSON.parse(stdout), receipt);
  const prices = await pool.query(`SELECT id, product_id, shop_id, captured_at, price_amount, currency,
    source_test_shop, review FROM cheapo.price_observation WHERE household_id = $1 ORDER BY captured_at`, [householdId]);
  assert.deepEqual(prices.rows.map(({ id, price_amount }) => [id, price_amount]), [
    [earlier.id, '2.95'], [record.id, '3.19'], [unlinked.id, null],
  ]);
  assert.equal(prices.rows[1].captured_at.toISOString(), record.capturedAt);
  assert.deepEqual(prices.rows[1].review, record.review);
  assert.equal(prices.rows[2].product_id, null);
  assert.equal(prices.rows[2].shop_id, null);
  assert.equal(prices.rows[2].currency, null);
  assert.equal(prices.rows[2].source_test_shop, true);
  assert.deepEqual(prices.rows[2].review, unlinked.review);
  assert.equal((await pool.query('SELECT gtin FROM cheapo.product WHERE id = $1', [product.id])).rows[0].gtin, '00012345600029');
  assert.equal((await pool.query('SELECT previous_gtin FROM cheapo.catalog_revision WHERE household_id = $1', [householdId])).rows[0].previous_gtin, product.barcode);
  const selected = await pool.query(`SELECT shop.name, saved.nickname FROM cheapo.shopper_current_shop AS current
    JOIN cheapo.household_saved_shop AS saved USING (household_id, shop_id) JOIN cheapo.shop ON shop.id = current.shop_id
    WHERE current.household_id = $1 AND current.shopper_id = $2`, [householdId, shopperId]);
  assert.deepEqual(selected.rows, [{ name: shop.name, nickname: shop.nickname }]);
  const photos = await pool.query('SELECT sha256, storage_key FROM cheapo.price_photo WHERE household_id = $1 ORDER BY role', [householdId]);
  assert.deepEqual(photos.rows, [...snapshot.photos].reverse().map(({ sha256 }) => ({ sha256, storage_key: `${sha256}.jpg` })));
  assert.deepEqual((await readdir(objects)).sort(), photos.rows.map(({ storage_key }) => storage_key).sort());
  for (const { path, sha256 } of snapshot.photos) {
    assert.deepEqual(await readFile(join(objects, `${sha256}.jpg`)), await readFile(join(directory, path)));
  }
  const receipts = await pool.query('SELECT sha256, source_catalog FROM cheapo.shopping_import_receipt WHERE household_id = $1', [householdId]);
  assert.deepEqual(receipts.rows, [{ sha256: receipt.sha256, source_catalog: fixture.catalog }]);
});

test('rolls back a partial restore and does not replace an existing price', async () => {
  const snapshot = await plan();
  await assert.rejects(applyShoppingImport(pool, otherOwner, snapshot, async () => { throw new Error('Asset write failed'); }), /Asset write failed/);
  assert.equal((await pool.query('SELECT 1 FROM cheapo.price_observation WHERE household_id = $1', [otherHouseholdId])).rowCount, 0);
  assert.equal((await pool.query('SELECT 1 FROM cheapo.household_saved_shop WHERE household_id = $1', [otherHouseholdId])).rowCount, 0);
  const changed = { ...record, review: { ...record.review, price: '4.59' } };
  const edited = await plan({ ...fixture, records: [earlier, changed, unlinked] });
  await assert.rejects(applyShoppingImport(pool, owner, edited, ensurePhoto), /price observation conflicts/);
  assert.equal((await pool.query('SELECT price_amount FROM cheapo.price_observation WHERE household_id = $1 AND id = $2', [householdId, record.id])).rows[0].price_amount, '3.19');
});


test('restores older archives alongside v3 without inventing catalog links or clearing current shop', async () => {
  const legacyPhoto = { ...record, id: 'legacy-v1-photo', productId: undefined };
  const legacyManual = { ...earlier, id: 'legacy-v2-manual' };
  for (const [version, observation] of [[1, legacyPhoto], [2, legacyManual]] as const) {
    const snapshot = await plan({ version, exportedAt: fixture.exportedAt, records: [observation], savedShops: [shop] });
    const receipt = await applyShoppingImport(pool, owner, snapshot, ensurePhoto);
    assert.equal(receipt.version, version);
    assert.equal(receipt.hasCatalog, false);
    assert.equal(receipt.hasCurrentShopSelection, false);
  }
  const observed = await pool.query(`SELECT id, product_id, source_product_id FROM cheapo.price_observation
    WHERE household_id = $1 AND id IN ($2, $3) ORDER BY id`, [householdId, legacyPhoto.id, legacyManual.id]);
  assert.deepEqual(observed.rows, [
    { id: legacyPhoto.id, product_id: null, source_product_id: null },
    { id: legacyManual.id, product_id: null, source_product_id: product.id },
  ]);
  const selection = await pool.query('SELECT shop_id FROM cheapo.shopper_current_shop WHERE household_id = $1 AND shopper_id = $2', [householdId, shopperId]);
  assert.equal(selection.rows[0].shop_id, shop.id);
  assert.equal((await readdir(objects)).length, 2);
});

test('a changed source photo and a conflicting stored object cannot replace verified bytes', async () => {
  const { photos } = await plan();
  const photo = photos[0];
  const previous = await readFile(join(directory, photo.path));
  await writeFile(join(directory, photo.path), Buffer.concat([previous, Buffer.from([0])]));
  await assert.rejects(ensurePhoto(photo), /size does not match/);
  assert.deepEqual(await readFile(join(objects, `${photo.sha256}.jpg`)), previous);
  await writeFile(join(directory, photo.path), previous);
  const destination = join(objects, `${photo.sha256}.jpg`);
  const corrupt = Buffer.alloc(previous.length, 1);
  await writeFile(destination, corrupt);
  await assert.rejects(ensurePhoto(photo), /hash does not match/);
  assert.deepEqual(await readFile(destination), corrupt);
});
