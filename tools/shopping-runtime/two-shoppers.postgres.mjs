import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';

import { credentialDigest } from '../../apps/api/credential.ts';
import { importedEvidenceKey } from '../../apps/api/evidence-key.ts';
import { createLocalApi } from '../../apps/api/local-api.ts';
import { createCheapoPricePhotoRead } from '../../apps/mobile/data/cheapo-price-photo-read.ts';
import { cheapoShoppingReadCache, cheapoPricePhotoCache } from '../../apps/mobile/data/cheapo-shopping-read-cache.ts';
import { createCheapoShoppingReads } from '../../apps/mobile/data/cheapo-shopping-reads.ts';
import { readEnrolledPriceEdit } from '../../apps/mobile/data/edit-enrolled-price.ts';
import { createEnrolledComparisonPreferences } from '../../apps/mobile/data/enrolled-comparison-preferences.ts';
import { createEnrolledCatalog } from '../../apps/mobile/data/enrolled-catalog.ts';
import { createEnrolledSavedShops } from '../../apps/mobile/data/enrolled-saved-shops.ts';
import { emptyReview } from '../../apps/mobile/data/photo-review.ts';
import { projectSharedPrice } from '../../apps/mobile/data/saved-price-history.ts';
import { createSelectedPricePhotoRead, viewedPricePhotoRoles } from '../../apps/mobile/data/selected-price-photo-read.ts';
import { openCheapoShopping } from '../../apps/mobile/data/shopping-sync-runtime.ts';
import { createCheapoAccess } from '../../apps/mobile/lib/cheapo-access/client.ts';
import { configureObjectTransport, device } from './expo-fixtures.mjs';

// Use the installed PostgreSQL client from the package that owns the real API adapter.
const { Pool } = createRequire(new URL('../../apps/api/package.json', import.meta.url))('pg');

const host = process.env.CHEAPO_TEST_PG_SOCKET;
const fixture = process.env.CHEAPO_TEST_FILES;
if (!host || !fixture) throw Error('Run this suite through the disposable PostgreSQL test driver.');
const options = { host, port: Number(process.env.CHEAPO_TEST_PG_PORT),
  user: 'cheapo_test', database: 'postgres' };
const operator = new Pool(options);
const runtimePool = new Pool({ ...options, user: 'two_owner_runtime' });
const house = randomUUID();
const outside = randomUUID();
const origin = 'https://shopping.example';
const authors = { A: house, B: house, C: outside };
const people = {};
const fixturePhoto = name => new URL('../../apps/mobile/stories/fixtures/' + name, import.meta.url).href;
const digest = (value, format = 'hex') => createHash('sha256').update(value).digest(format);
const blobPath = (key) => join(fixture, 'objects', digest(key));
const grantUrl = key => 'https://fixtures.s3.amazonaws.com/object/' + encodeURIComponent(key) + '?X-Amz-Signature=' + 'a'.repeat(64);
const photoGrants = [];
const api = createLocalApi(runtimePool, {
  read: async key => { photoGrants.push(key); return grantUrl(key); },
  upload: async (key, photo) => ({
    url: grantUrl(key), headers: {
      'Content-Type': 'image/jpeg', 'Content-Length': String(photo.byteCount), 'If-None-Match': '*',
      'x-amz-checksum-sha256': Buffer.from(photo.sha256, 'hex').toString('base64'),
    },
  }),
  verify: async (key, photo) => {
    const object = await readFile(blobPath(key)).catch(() => null);
    return !object ? 'missing' : digest(object) === photo.sha256 && object.byteLength === photo.byteCount ? 'verified' : 'mismatch';
  },
});
let objectWrites = 0;
configureObjectTransport(async (url, init) => {
  const headers = new Headers(init?.headers);
  assert.equal(headers.has('Authorization'), false);
  const key = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
  if (init?.method === 'PUT') {
    const body = Buffer.from(init.body);
    assert.equal(headers.get('Content-Length'), String(body.byteLength));
    assert.equal(headers.get('x-amz-checksum-sha256'), digest(body, 'base64'));
    assert.equal(headers.get('If-None-Match'), '*');
    try { await writeFile(blobPath(key), body, { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') return new Response(null, { status: 412 }); throw error; }
    objectWrites++;
    return new Response(null, { status: 200 });
  }
  const body = await readFile(blobPath(key));
  return new Response(body, { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(body.byteLength) } });
});
function freshAccess(person) {
  // This private temp file stands in for the platform's SecureStore adapter.
  const storage = {
    getItem: async () => readFile(join(person.root, 'enrollment'), 'utf8').catch(() => null),
    setItem: async (_key, value) => writeFile(join(person.root, 'enrollment'), value, { mode: 0o600 }),
    deleteItem: async () => rm(join(person.root, 'enrollment'), { force: true }),
  };
  return createCheapoAccess(origin, storage, async (url, init) => {
    if (!person.online) throw Error('Fixture device is offline');
    if (init.method === 'PATCH' && person.waitBeforePatch) await person.waitBeforePatch;
    // Send actual Request and Response objects through the production router in-process.
    const response = await api(new Request(url, init));
    if (init.method === 'PATCH' && person.releaseAfterPatch) person.releaseAfterPatch();
    if (person.dropAppend && new URL(url).pathname.endsWith('/price-observations') && init.method === 'POST' && response.status === 201) {
      person.dropAppend = false;
      throw Error('Fixture lost the committed acknowledgement');
    }
    return response;
  }, async value => digest(value));
}
const operate = (name, run) => device.run(people[name].root, () => run(people[name]));
const collection = '/v1/me/price-observations';
const raw = (person, path, method = 'GET', body) => person.access.request(path, { method,
  ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
const readers = person => createCheapoShoppingReads(person.access.openReadSession, cheapoShoppingReadCache);
const observed = async (name, id) => operate(name, async person =>
  (await readers(person).loadPriceObservation(id)).value.observation);
const initialBarcode = '2000000000015';
const product = {
  id: 'two-owner-rolled-oats', barcode: '2000000000022', name: 'Example oats', productType: 'Oats',
  brand: 'Example Mill', variety: 'Rolled', pack: { quantity: 500, unit: 'g' },
};
const groupId = 'two-owner-oats';
const units = price => (Number(price) / 5).toFixed(3);
const reviewFields = price => ({
  productName: product.name, productType: product.productType, brand: product.brand, variety: product.variety,
  packSize: '500 g', currency: 'GBP', price, unitPrice: units(price), unit: '100g',
});
const edits = (price, extras = {}) => ({ action: 'correct',
  review: reviewFields(price), unitPrice: { amount: Number(units(price)), unit: '100g' }, ...extras });
let clock = 0;
const mutation = (target, change) => ({ operationId: randomUUID(), title: 'Correct synthetic price',
  createdAt: new Date(Date.UTC(2026, 0, 10) + clock++).toISOString(), action: { kind: 'price', ...target, change } });
const target = (id, version) => ({ priceKey: id, base: { kind: 'version', id, version } });
const pending = (id, previous) => ({ priceKey: id, base: { kind: 'operation', operationId: previous } });
const summary = [];
try {
  await mkdir(join(fixture, 'objects'));
  await operator.query('CREATE ROLE two_owner_runtime LOGIN IN ROLE cheapo_api_runtime');
  await operator.query('INSERT INTO cheapo.household VALUES ($1), ($2)', [house, outside]);
  for (const [name, householdId] of Object.entries(authors)) {
    const shopperId = randomUUID();
    const credential = 'cheapo_' + randomBytes(32).toString('base64url');
    const root = join(fixture, name);
    await mkdir(root);
    await operator.query('INSERT INTO cheapo.shopper VALUES ($1)', [shopperId]);
    await operator.query('INSERT INTO cheapo.household_membership (household_id, shopper_id) VALUES ($1, $2)', [householdId, shopperId]);
    await operator.query(`INSERT INTO cheapo.shopper_credential (token_digest, household_id, shopper_id, expires_at)
      VALUES ($1, $2, $3, statement_timestamp() + interval '1 day')`, [credentialDigest(credential), householdId, shopperId]);
    const person = people[name] = { root, online: true };
    person.access = freshAccess(person);
    await operate(name, async () => {
      await person.access.enroll(credential);
      person.runtime = await openCheapoShopping(person.access);
      assert.equal(person.runtime.owner.shopperId, shopperId);
      const queue = person.runtime.mutationQueue;
      const { assertOwner: assertCurrent, retry: sync } = person.runtime;
      person.shops = createEnrolledSavedShops({
        queue, assertCurrent, sync, loadHosted: operations => readers(person).loadEditableSavedShops(undefined, operations),
      });
      const reads = readers(person);
      person.catalog = createEnrolledCatalog({
        queue, assertCurrent, sync, readByBarcode: reads.findEditableProductByBarcode, readById: reads.findEditableProductById,
      });
      person.preferences = createEnrolledComparisonPreferences({ queue, assertOwner: assertCurrent, sync,
        readHosted: reads.loadComparisonPreference,
      });
    });
  }
  await operate('A', async person => {
    const beforePreference = await person.preferences.load(groupId);
    assert.equal(beforePreference.basis, null);
    person.online = false;
    const saved = await person.shops.saveShop({ id: 'fixture-market', name: 'Fixture Market', nickname: 'Before rename' }, { select: true });
    assert.equal(saved.currentShop.nickname, 'Before rename');
    await person.shops.updateShop('fixture-market', { nickname: 'Household nickname' }, saved.editBases.get('fixture-market'));
    const first = await person.catalog.save({ ...product, barcode: initialBarcode });
    assert.equal(first.catalogBase.kind, 'operation');
    assert.equal((await person.catalog.findByBarcode(initialBarcode)).id, product.id);
    const corrected = await person.catalog.replaceBarcode(first, product.barcode);
    assert.equal(corrected.catalogBase.kind, 'operation');
    assert.equal((await person.catalog.findById(product.id)).barcode, '02000000000022');
    const changed = await person.preferences.save(beforePreference, 'kg');
    assert.equal(changed.base.kind, 'operation');
    assert.equal((await person.preferences.loadLocal(groupId)).basis, 'kg');
    person.online = true;
    assert.equal((await person.runtime.retry()).state, 'complete');
  });
  await operate('B', async person => {
    await person.shops.saveShop({ id: 'fixture-second', name: 'Second Market' }, { select: true });
    assert.equal((await person.runtime.retry()).state, 'complete');
  });
  await operate('C', async person => {
    await person.shops.saveShop({ id: 'fixture-market', name: 'Fixture Market', nickname: 'Outside nickname' }, { select: true });
    assert.equal((await person.runtime.retry()).state, 'complete');
  });
  const shopA = await operate('A', person => person.shops.loadSavedShops());
  const shopB = await operate('B', person => person.shops.loadSavedShops());
  const shopC = await operate('C', person => person.shops.loadSavedShops());
  assert.equal(shopA.currentShop.id, 'fixture-market');
  assert.equal(shopB.currentShop.id, 'fixture-second');
  assert.equal(shopB.shops.find(shop => shop.id === 'fixture-market').nickname, 'Household nickname');
  assert.equal(shopC.currentShop.nickname, 'Outside nickname');
  const preferenceA = await operate('A', person => person.preferences.load(groupId));
  const preferenceB = await operate('B', person => person.preferences.load(groupId));
  assert.equal(preferenceA.basis, 'kg');
  assert.equal(preferenceB.basis, null);
  assert.deepEqual(preferenceA.base, { kind: 'version', version: 1 });
  assert.deepEqual(preferenceB.base, { kind: 'version', version: 0 });
  await operate('B', async person => {
    assert.equal(await person.catalog.findByBarcode(initialBarcode), undefined);
    const read = await person.catalog.findByBarcode(product.barcode);
    assert.deepEqual(read, { ...product, barcode: '02000000000022', catalogBase: { kind: 'version', version: 2 } });
    person.online = false;
    const reopened = await person.catalog.findByBarcode(product.barcode);
    assert.deepEqual(reopened, read);
    person.online = true;
  });
  summary.push('The enrolled shop repository isolates household nicknames and personal current shops; queued catalog and comparison-preference changes keep exact IDs, versions and personal basis boundaries.');

  const id = 'offline-oats';
  const original = { uri: fixturePhoto('price-label-original.jpg'), width: 700, height: 490, mimeType: 'image/jpeg' };
  const crop = { uri: fixturePhoto('price-label-crop.jpg'), width: 560, height: 278, mimeType: 'image/jpeg' };
  const cropBox = { left: 0.1, top: 0.3, right: 0.9, bottom: 0.87 };
  const review = { ...emptyReview('Fixture Market'), ...reviewFields('3.10') };
  await operate('A', async person => {
    person.online = false;
    const { record, pending: state } = await person.runtime.priceRecords.saveNewPhoto({
      id, productId: product.id, capturedAt: '2026-01-02T09:30:00.123Z', original, selected: crop, cropBox, review,
      shop: { id: 'fixture-market', displayName: 'Fixture Market' },
    });
    assert.equal(state, 'waiting');
    const { target: editTarget } = await readEnrolledPriceEdit(person.runtime, record);
    assert.deepEqual(editTarget.base, { kind: 'append', sourceId: id });
    await person.runtime.commitMutation(mutation(editTarget, edits('3.25')));
    assert.equal((await person.runtime.retry()).state, 'pending');
  });
  const canonical = await operate('A', async person => {
    person.access = freshAccess(person);
    person.runtime = await openCheapoShopping(person.access);
    assert.equal((await person.runtime.priceRecords.load(id)).review.price, '3.10');
    assert.equal((await person.runtime.loadPriceChanges())[0].change.review.price, '3.25');
    person.online = true;
    person.dropAppend = true;
    assert.equal((await person.runtime.retry()).state, 'pending');
    const before = await operator.query('SELECT count(*)::int AS count FROM cheapo.price_observation WHERE household_id=$1 AND id=$2', [house, id]);
    assert.equal(before.rows[0].count, 1);
    assert.equal((await person.runtime.retry()).state, 'complete');
    assert.equal((await person.runtime.retry()).state, 'complete');
    return (await person.runtime.priceQueue.read()).entries[0].receipt.id;
  });
  const initial = await observed('B', canonical);
  assert.equal(initial.id, canonical);
  assert.equal(Number(initial.priceAmount), 3.25);
  assert.equal(initial.productId, product.id);
  assert.deepEqual(initial.review, { ...reviewFields('3.25'), shop: 'Fixture Market' });
  assert.deepEqual(initial.unitPrice, { amount: 0.65, unit: '100g' });
  assert.deepEqual(initial.cropBox, cropBox);
  assert.equal(initial.version, 2);
  assert.equal(initial.ownedByCurrentShopper, false);
  assert.equal(initial.selectedPhotoRole, 'crop');
  assert.equal(objectWrites, 2);
  await operate('B', async person => {
    const get = createCheapoPricePhotoRead(person.access.openReadSession, cheapoPricePhotoCache);
    for (const [role, expected] of [['original', original], ['crop', crop]]) {
      const downloaded = await get(canonical, role);
      assert.equal(downloaded.status, 'fresh');
      assert.deepEqual(await readFile(new URL(downloaded.value.uri)), await readFile(new URL(expected.uri)));
    }
    person.online = false;
    assert.equal((await get(canonical, 'crop')).status, 'cached');
    assert((await cheapoShoppingReadCache.measureBytes()) > 0);
    person.online = true;
  });
  assert.equal((await operate('C', person => raw(person, collection + '/' + canonical))).status, 404);
  const sourceFilter = { sourceId: id, includeRecordedInError: true };
  const own = await operate('A', person => readers(person).loadPriceHistory(sourceFilter));
  const another = await operate('B', person => readers(person).loadPriceHistory(sourceFilter));
  assert.deepEqual(own.value.observations.map(price => price.id), [canonical]);
  assert.deepEqual(another.value.observations, []);
  const offlineOther = await operate('B', async person => {
    person.online = false;
    const read = await readers(person).loadPriceHistory(sourceFilter);
    person.online = true;
    return read;
  });
  assert.equal(offlineOther.status, 'cached');
  assert.deepEqual(offlineOther.value.observations, []);
  summary.push('Actual offline save and edit survived reopening, a committed append response was lost, and replay produced one corrected observation with two independently verified photos visible to B only inside the household.');

  const editA = mutation(target(canonical, 2), edits('3.45'));
  const editB = mutation(target(canonical, 2), edits('3.50'));
  const editLater = mutation(pending(canonical, editB.operationId), edits('3.55'));
  await operate('A', person => person.runtime.commitMutation(editA));
  await operate('B', async person => { await person.runtime.commitMutation(editB); await person.runtime.commitMutation(editLater); });
  people.B.waitBeforePatch = new Promise(resolve => { people.A.releaseAfterPatch = resolve; });
  await Promise.all(['A', 'B'].map(name => operate(name, person => person.runtime.retry())));
  people.B.waitBeforePatch = undefined;
  people.A.releaseAfterPatch = undefined;
  const [entryA, entryB] = await Promise.all(['A', 'B'].map((name, i) => operate(name, async person =>
    (await person.runtime.mutationQueue.read()).entries.find(x => x.intent.operationId === [editA, editB][i].operationId))));
  assert.deepEqual([entryA.outcome.kind, entryB.outcome.kind].sort(), ['applied', 'conflict']);
  const loser = entryA.outcome.kind === 'conflict' ? 'A' : 'B';
  const losing = editB;
  assert.equal(loser, 'B');
  const winning = '3.45';
  const conflictEntry = entryB;
  const chosenVersion = conflictEntry.outcome.currentVersion;
  await operate(loser, async person => {
    await person.runtime.resolveConflict(losing.operationId, { kind: 'keep-cloud', laterIds: [editLater.operationId] });
    const later = (await person.runtime.mutationQueue.read()).entries.find(x => x.intent.operationId === editLater.operationId);
    assert(later.superseded);
    const chosen = (await person.runtime.loadPriceChanges()).find(x => x.operationId === losing.operationId);
    assert.equal(chosen.change.action, 'keep_cloud');
    assert.equal(chosen.acceptedVersion, chosenVersion);
    assert.equal(Number(projectSharedPrice(initial, [chosen]).display.priceAmount), Number(winning));
  });

  const state = await observed('B', canonical);
  const older = mutation(target(canonical, state.version), edits('3.70'));
  const dependent = mutation(pending(canonical, older.operationId), edits('3.75'));
  await operate('B', async person => { await person.runtime.commitMutation(older); await person.runtime.commitMutation(dependent); });
  await operate('A', async person => {
    await person.runtime.commitMutation(mutation(target(canonical, state.version), edits('3.61')));
    assert.equal((await person.runtime.retry()).state, 'complete');
  });
  await operate('B', async person => {
    assert.equal((await person.runtime.retry()).state, 'pending');
    const conflict = (await person.runtime.mutationQueue.read()).entries.find(x => x.intent.operationId === older.operationId);
    assert.equal(conflict.outcome.kind, 'conflict');
    await person.runtime.resolveConflict(older.operationId, {
      kind: 'keep-phone', replacementId: randomUUID(), createdAt: new Date().toISOString(),
    });
    assert.equal((await person.runtime.retry()).state, 'complete');
  });
  const newest = await observed('A', canonical);
  assert.equal(Number(newest.priceAmount), 3.75);
  summary.push('Concurrent edits produced one conflict. Keep cloud retained its validated snapshot and Keep phone retried against the current version while preserving a dependent edit.');

  const revisedBox = { left: 0.05, top: 0.2, right: 0.85, bottom: 0.76734693877551 };
  await operate('A', async person => {
    person.online = false;
    await person.runtime.commitMutation(mutation(target(canonical, newest.version), edits('3.75', {
      photoSelection: { role: 'crop', cropBox: revisedBox },
    })));
    const change = (await person.runtime.loadPriceChanges()).at(-1);
    assert.deepEqual(change.change.photoSelection, { role: 'crop', cropBox: revisedBox });
    person.online = true;
    assert.equal((await person.runtime.retry()).state, 'complete');
  });
  const revised = await observed('B', canonical);
  assert.equal(revised.version, newest.version + 1);
  assert.equal(revised.cropSource, 'original');
  assert.equal(revised.selectedPhotoRole, 'crop');
  assert.deepEqual(revised.cropBox, revisedBox);
  assert.deepEqual(revised.photos, initial.photos);
  await operate('B', async person => {
    await cheapoShoppingReadCache.clear();
    const grantsBefore = photoGrants.length;
    const session = await person.access.openReadSession();
    const readPhoto = createCheapoPricePhotoRead(async () => session, cheapoPricePhotoCache);
    let renders = 0;
    const readSelection = createSelectedPricePhotoRead(session, cheapoPricePhotoCache, readPhoto, async (verified, normalized) => {
      // Stand in for the native pixel transform, using a distinct JPEG fixture derived from the sample.
      const originalBytes = await readFile(new URL(verified.uri));
      assert.equal(digest(originalBytes), verified.sha256);
      assert.deepEqual(originalBytes, await readFile(new URL(original.uri)));
      assert.deepEqual(normalized, revisedBox);
      renders++;
      const cropBytes = await readFile(new URL(crop.uri));
      const tagged = Buffer.concat([cropBytes.subarray(0, 2), Buffer.from([255, 254, 0, 7]), Buffer.from('newer'), cropBytes.subarray(2)]);
      return { bytes: Uint8Array.from(tagged), width: 560, height: 278, sha256: digest(tagged) };
    });
    const derived = await readSelection(revised, 'crop');
    assert.equal(derived.status, 'fresh');
    assert.equal(derived.value.width, 560);
    assert.equal(photoGrants.length, grantsBefore + 1);
    assert.match(photoGrants.at(-1), /\/original\//);
    assert.notDeepEqual(await readFile(new URL(derived.value.uri)), await readFile(new URL(crop.uri)));
    person.online = false;
    const offline = await readSelection(revised, 'crop');
    assert.equal(offline.status, 'cached');
    assert.equal(offline.value.uri, derived.value.uri);
    assert.equal(renders, 1);
    await cheapoShoppingReadCache.clear();
    assert.equal((await readSelection(revised, 'crop')).status, 'unavailable');
    person.online = true;
  });
  await operate('A', async person => {
    await person.runtime.commitMutation(mutation(target(canonical, revised.version), edits('3.75', {
      photoSelection: { role: 'original' },
    })));
    assert.equal((await person.runtime.retry()).state, 'complete');
  });
  const reverted = await observed('B', canonical);
  assert.equal(reverted.selectedPhotoRole, 'original');
  assert.equal(reverted.cropBox, null);
  assert.deepEqual(viewedPricePhotoRoles(reverted).map(asset => asset.role), ['original']);
  assert.deepEqual(reverted.photos, initial.photos);
  assert.equal(objectWrites, 2);
  summary.push('The queued re-crop changes the canonical selection, uses only the verified original, caches its derived image offline and preserves both physical evidence objects after revert.');

  await operate('A', async person => {
    await person.runtime.commitMutation(mutation(target(canonical, reverted.version), { action: 'record_in_error', reason: 'Synthetic review' }));
    assert.equal((await person.runtime.retry()).state, 'complete');
  });
  const removed = await observed('B', canonical);
  assert.equal(removed.recordedInErrorReason, 'Synthetic review');
  await operate('B', async person => {
    const comparison = await readers(person).loadPriceHistory({ productType: 'Oats' });
    assert.equal(comparison.value.observations.some(x => x.id === canonical), false);
    await person.runtime.commitMutation(mutation(target(canonical, removed.version), { action: 'undo_recorded_in_error' }));
    assert.equal((await person.runtime.retry()).state, 'complete');
    const restored = await readers(person).loadPriceHistory({ productType: 'Oats' });
    assert.equal(restored.value.observations.some(x => x.id === canonical), true);
  });
  summary.push('Recorded in error excluded the record from comparison and kept the exact detail; B’s undo restored it.');

  const draftSource = 'imported-draft-oats';
  const draftId = randomUUID();
  const draftTime = '2026-01-02T10:30:00.123Z';
  const draftOwner = people.A.runtime.owner.shopperId;
  await operator.query(`
    INSERT INTO cheapo.price_observation (household_id, shopper_id, id, resource_id, captured_at, source_test_shop, status)
    VALUES ($1, $2, $3, $4, $5, false, 'draft')
  `, [house, draftOwner, draftSource, draftId, draftTime]);
  const imported = await readFile(new URL(original.uri));
  const importedHash = digest(imported);
  const importedKey = importedEvidenceKey(house, draftOwner, importedHash);
  await writeFile(blobPath(importedKey), imported);
  await operator.query(`
    INSERT INTO cheapo.price_photo (household_id, shopper_id, observation_id, role, storage_key, sha256, byte_count, width, height)
    VALUES ($1, $2, $3, 'original', $4, $5, $6, $7, $8)
  `, [house, draftOwner, draftSource, importedKey, importedHash, imported.byteLength, original.width, original.height]);
  const originalPath = collection + '/' + draftId + '/photos/original';
  assert.equal((await operate('B', person => raw(person, originalPath))).status, 404);

  await operate('A', async person => {
    person.online = false;
    await person.runtime.priceRecords.saveNewPhoto({
      id: draftSource, capturedAt: draftTime, productId: product.id, original, selected: crop, cropBox: revisedBox,
      review: { ...emptyReview('Fixture Market'), ...reviewFields('3.88') },
      shop: { id: 'fixture-market', displayName: 'Fixture Market' },
    });
    person.online = true;
    person.dropAppend = true;
    assert.equal((await person.runtime.retry()).state, 'pending');
    assert.equal((await person.runtime.retry()).state, 'complete');
    const saved = (await person.runtime.priceQueue.read()).entries.find(entry => entry.record.id === draftSource);
    assert.deepEqual(saved.receipt, { id: draftId, sourceId: draftSource, version: 2, deriveCropFromOriginal: true });
    assert.deepEqual(await person.runtime.priceQueue.evidence.load({ record: saved.record, receipt: saved.receipt }), []);
  });
  const completedDraft = await observed('B', draftId);
  assert.equal(completedDraft.priceAmount, '3.88');
  assert.equal(completedDraft.version, 2);
  assert.equal(completedDraft.cropSource, 'original');
  assert.deepEqual(completedDraft.cropBox, revisedBox);
  assert.equal((await operate('B', person => raw(person, originalPath))).status, 200);
  assert.equal(photoGrants.at(-1), importedKey);
  assert.equal(objectWrites, 2);
  summary.push('The imported draft stayed private until completion, recovered a lost reply on the same resource ID, and acknowledged its exact archived original without uploading or replacing it.');

  await operate('A', async person => {
    const get = createCheapoPricePhotoRead(person.access.openReadSession, cheapoPricePhotoCache);
    await get(canonical, 'original');
    const waiting = mutation(target(canonical, (await readers(person).loadPriceObservation(canonical)).value.observation.version), edits('3.90'));
    await person.runtime.commitMutation(waiting);
    const filesBefore = await person.runtime.priceQueue.read();
    const backupBefore = await person.runtime.mutationQueue.backup(async mutations => ({ mutations, prices: await person.runtime.priceQueue.backup() }));
    assert((await cheapoShoppingReadCache.measureBytes()) > 0);
    await cheapoShoppingReadCache.clear();
    assert.equal(await cheapoShoppingReadCache.measureBytes(), 0);
    person.online = false;
    assert.equal((await get(canonical, 'original')).status, 'unavailable');
    const records = await person.runtime.priceRecords.loadAll({ requireAll: true });
    const protectedCopy = records.find(record => record.id === id);
    for (const role of ['original', 'selected']) assert((await readFile(new URL(protectedCopy[role].uri))).byteLength > 0);
    assert.deepEqual(await person.runtime.priceQueue.read(), filesBefore);
    const backupAfter = await person.runtime.mutationQueue.backup(async mutations => ({ mutations, prices: await person.runtime.priceQueue.backup() }));
    assert.deepEqual(backupAfter, backupBefore);
    assert((await person.runtime.readPending()).some(x => x.operationId === waiting.operationId));
  });
  summary.push('Actual Clear cache removed downloaded bytes and preserved queue phases, pending correction, original, crop and backup repository inputs.');
  summary.forEach(item => console.log('PASS', item));
} finally {
  await runtimePool.end();
  await operator.end();
}
