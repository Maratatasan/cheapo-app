import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { planShoppingImport } from '../shopping-import-plan.ts';

const jpegHeaderFixture = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const source = { appName: 'Cheapo test', appVersion: '1.0.0', androidVersionCode: 1, platform: 'android' };
const testShop = { id: 'shop-fixture', displayName: 'Test shop', nickname: 'Test shop', testShop: true };
const product = { id: 'product-fixture', name: 'Porridge oats', barcode: '00012345600012' };
const observation = {
  id: 'price-fixture', capturedAt: '2026-01-02T11:22:33.789Z', productName: null,
  productId: product.id, shop: { id: testShop.id, displayName: 'Shop when captured' }, testShop: true,
  status: 'draft', review: { productName: ' Porridge oats ', price: '  ', currency: '$', packSize: null },
  unitPrice: null, cropBox: null, photos: null,
};
const exportBase = { exportedAt: '2026-01-02T12:00:00.000Z', records: [observation], savedShops: [testShop] };
const original = { path: 'photos/1/original.jpg', width: 3, height: 2, mimeType: 'image/jpeg' };
const crop = { path: 'photos/1/crop.jpg', width: 2, height: 2, mimeType: 'image/jpeg' };
const photoObservation = { ...observation, photos: { original, crop, selectedPath: crop.path } };

async function snapshot(t: TestContext, manifest: object) {
  const directory = await mkdtemp(join(tmpdir(), 'cheapo-import-plan-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  return directory;
}

function fullBackup() {
  return {
    ...exportBase, version: 3, source, currentShopId: testShop.id,
    catalog: {
      legacyProducts: [], originalProducts: [product],
      corrections: [{ revision: 1, previous: product.barcode, product: { ...product, barcode: '00012345600029' } }],
    },
  };
}

test('plans v3 catalog revisions, current shop, preserved drafts and independent price photos', async t => {
  const directory = await snapshot(t, { ...fullBackup(), records: [photoObservation, {
    ...observation, id: 'price-before-shop', shop: { id: 'removed-shop', displayName: 'Past shop' },
  }] });
  await mkdir(join(directory, 'photos/1'), { recursive: true });
  await writeFile(join(directory, original.path), jpegHeaderFixture);
  const cropBytes = Buffer.concat([jpegHeaderFixture, Buffer.from([7])]);
  await writeFile(join(directory, crop.path), cropBytes);
  const plan = await planShoppingImport(directory);
  assert.deepEqual(plan.summary, {
    version: 3, hasCatalog: true, hasCurrentShopSelection: true, products: 1, catalogRevisions: 1,
    savedShops: 1, observations: 2, drafts: 2, flaggedTestObservations: 2, unresolvedProductIds: 0,
    unresolvedShopIds: 1, originals: 1, crops: 1,
  });
  assert.equal(plan.currentShopId, testShop.id);
  assert.equal(plan.products[0].gtin, '00012345600029');
  assert.equal(plan.revisions[0].previous, product.barcode);
  assert.deepEqual(plan.sourceCatalog?.originalProducts, [product]);
  assert.deepEqual(plan.source, source);
  assert.deepEqual(plan.observations[0].review, observation.review);
  assert.equal(plan.observations[0].linkedProductId, product.id);
  assert.equal(plan.observations[1].linkedShopId, null);
  assert.equal(plan.photos[0].sha256, createHash('sha256').update(jpegHeaderFixture).digest('hex'));
  assert.equal(plan.photos[1].sha256, createHash('sha256').update(cropBytes).digest('hex'));
});

test('preserves legacy data without claiming absent catalog or selection data', async t => {
  const v1 = await snapshot(t, { ...exportBase, version: 1, records: [{ ...photoObservation, productId: undefined,
    photos: { original, crop: null, selectedPath: original.path },
  }] });
  await mkdir(join(v1, 'photos/1'), { recursive: true });
  await writeFile(join(v1, original.path), jpegHeaderFixture);
  assert.equal((await planShoppingImport(v1)).summary.originals, 1);

  const v2 = await snapshot(t, { ...exportBase, version: 2 });
  const plan = await planShoppingImport(v2);
  assert.equal(plan.summary.hasCatalog, false);
  assert.equal(plan.summary.hasCurrentShopSelection, false);
  assert.equal(plan.summary.unresolvedProductIds, 1);
  assert.equal(plan.observations[0].productId, product.id);
  assert.equal(plan.observations[0].linkedProductId, null);
});

test('fails on duplicate identities and inconsistent v3 catalog links', async t => {
  const duplicate = await snapshot(t, { ...fullBackup(), records: [observation, observation] });
  await assert.rejects(planShoppingImport(duplicate), /Duplicate IDs in price observations/);
  const stale = fullBackup();
  stale.catalog.corrections[0].previous = '00012345600029';
  await assert.rejects(planShoppingImport(await snapshot(t, stale)), /correction 1 conflicts/);
  const missing = { ...fullBackup(), records: [{ ...observation, productId: 'removed-product' }] };
  await assert.rejects(planShoppingImport(await snapshot(t, missing)), /missing product in the complete backup/);
});

test('rejects missing, redirected, and non-JPEG assets before a restore', async t => {
  const directory = await snapshot(t, { ...fullBackup(), records: [photoObservation] });
  await assert.rejects(planShoppingImport(directory), /Missing or unsafe backup file photos\/1\/original.jpg/);
  await mkdir(join(directory, 'photos/1'), { recursive: true });
  await symlink(join(directory, 'manifest.json'), join(directory, original.path));
  await assert.rejects(planShoppingImport(directory), /Missing or unsafe backup file/);
  await rm(join(directory, original.path));
  await writeFile(join(directory, original.path), 'a file without a JPEG marker');
  await assert.rejects(planShoppingImport(directory), /Unreadable JPEG/);
  const selectedPath = 'photos/2/original.jpg';
  const badReference = { ...photoObservation, photos: { ...photoObservation.photos, selectedPath } };
  const badDirectory = await snapshot(t, { ...fullBackup(), records: [badReference] });
  await assert.rejects(planShoppingImport(badDirectory), /selected photo does not match/);
});
