import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { priceHistoryDetail } from '@cheapo/domain/price-history';
import { Pool } from 'pg';

import { credentialDigest } from '../credential.ts';
import { importedEvidenceKey, newEvidenceKey } from '../evidence-key.ts';
import { createLocalApi } from '../local-api.ts';
import { localHttpServer } from '../server.ts';

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
const awaitingPhoto = '19000000-0000-4000-8000-000000000025';
const token = (letter: string) => `cheapo_${'r190'.repeat(10)}${letter.repeat(3)}`;
const signed: string[] = [];
const signedFixture = 'https://evidence.example/fixture-url';
const uploads: string[] = [];
const checked: string[] = [];
let objectStatus: 'verified' | 'missing' | 'mismatch' = 'missing';
const api = createLocalApi(runtime, {
  read: async key => { signed.push(key); return signedFixture; },
  verify: async (key, _photo, signal) => {
    assert.equal(signal.aborted, false);
    checked.push(key);
    return objectStatus;
  },
  upload: async key => {
    uploads.push(key);
    return { url: 'https://evidence.example/fixture-upload', headers: { 'Content-Type': 'image/jpeg' } };
  },
});
const server = localHttpServer(api);

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
    [testRecord, 'complete', true], [invalidObject, 'complete', false], [awaitingPhoto, 'complete', false],
  ]) {
    const sourceId = 'restored-' + resourceId;
    await operator.query(`
      INSERT INTO cheapo.price_observation (household_id, shopper_id, id, resource_id, captured_at, status, source_test_shop)
      VALUES ($1, $2, $3, $4, statement_timestamp(), $5, $6)
    `, [household, owner, sourceId, resourceId, status, testShop]);
    if (resourceId === awaitingPhoto) continue;
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
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
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

const uploadMetadata = { sha256: '8'.repeat(64), byteCount: 2_000, width: 800, height: 600 };

function prepare(id: string, actor: string, metadata = uploadMetadata, role = 'original') {
  return api(new Request(`http://localhost/v1/me/price-observations/${id}/photos/${role}/upload`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token(actor)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  }));
}

test('prepares one immutable pending upload across identical concurrent attempts', async () => {
  const results = await Promise.all([prepare(awaitingPhoto, 'A'), prepare(awaitingPhoto, 'A')]);
  const expectedKey = newEvidenceKey(household, awaitingPhoto, 'original', uploadMetadata.sha256);
  for (const response of results) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      role: 'original', availability: 'pending',
      url: 'https://evidence.example/fixture-upload',
      headers: { 'Content-Type': 'image/jpeg' }, expiresInSeconds: 120,
    });
  }
  assert.deepEqual(uploads, [expectedKey, expectedKey]);
  const { rows: [{ count }] } = await operator.query(`
    SELECT count(*)::int AS count FROM cheapo.price_photo_upload
    WHERE household_id = $1 AND observation_id = $2
  `, [household, 'restored-' + awaitingPhoto]);
  assert.equal(count, 1);
  assert.equal((await photo(awaitingPhoto, 'original', 'A')).status, 404);
});

test('denies foreign, draft, test, existing, oversized and conflicting photo declarations', async () => {
  const before = uploads.length;
  for (const [id, actor, status] of [
    [awaitingPhoto, 'B', 404], [awaitingPhoto, 'C', 404], [awaitingPhoto, 'D', 403], [awaitingPhoto, 'E', 401],
    [draft, 'A', 404], [testRecord, 'A', 404], [completed, 'A', 409],
  ] as const) {
    assert.equal((await prepare(id, actor)).status, status);
  }
  assert.equal((await prepare(awaitingPhoto, 'A', { ...uploadMetadata, byteCount: 32 * 1024 * 1024 + 1 })).status, 400);
  assert.equal((await prepare(awaitingPhoto, 'A', { ...uploadMetadata, sha256: '9'.repeat(64) })).status, 409);
  assert.equal(uploads.length, before);
  await assert.rejects(runtime.query('UPDATE cheapo.price_photo_upload SET sha256 = sha256'), { code: '42501' });
  await assert.rejects(runtime.query('DELETE FROM cheapo.price_photo_upload'), { code: '42501' });
});

function complete(id: string, actor: string, role = 'original') {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return fetch(`http://127.0.0.1:${address.port}/v1/me/price-observations/${id}/photos/${role}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token(actor)}` },
  });
}

async function visiblePhotos(id: string, selected = 'original') {
  const response = await api(new Request('http://localhost/v1/me/price-observations/' + id, {
    headers: { Authorization: `Bearer ${token('B')}` },
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { observation: { photos: unknown[]; selectedPhotoRole: string } };
  assert.equal(body.observation.selectedPhotoRole, selected);
  return body.observation.photos;
}

test('shows pending metadata to household readers and publishes only a verified object', async () => {
  assert.equal((await prepare(awaitingPhoto, 'A')).status, 200);
  const base = { role: 'original', width: 800, height: 600 };
  assert.deepEqual(await visiblePhotos(awaitingPhoto), [{ ...base, availability: 'pending' }]);
  assert.equal((await photo(awaitingPhoto, 'original', 'B')).status, 404);

  const denied = await complete(awaitingPhoto, 'B');
  assert.equal(denied.status, 404);
  assert.deepEqual(checked, []);
  assert.deepEqual(await (await complete(awaitingPhoto, 'A')).json(), {
    role: 'original', availability: 'pending',
  });
  objectStatus = 'mismatch';
  const mismatch = await complete(awaitingPhoto, 'A');
  assert.equal(mismatch.status, 409);
  assert.deepEqual(await mismatch.json(), { error: 'photo_checksum_mismatch' });
  assert.deepEqual(await visiblePhotos(awaitingPhoto), [{ ...base, availability: 'pending' }]);

  objectStatus = 'verified';
  const final = await Promise.all([complete(awaitingPhoto, 'A'), complete(awaitingPhoto, 'A')]);
  for (const response of final) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { role: 'original', availability: 'available' });
  }
  const readKey = newEvidenceKey(household, awaitingPhoto, 'original', uploadMetadata.sha256);
  assert(checked.length > 0);
  assert(checked.every(key => key === readKey));
  assert.deepEqual(await visiblePhotos(awaitingPhoto), [base]);
  assert.equal((await photo(awaitingPhoto, 'original', 'B')).status, 200);
  assert.equal(signed.at(-1), readKey);
});

test('recovers a lost response by replaying completion or identical preparation', async () => {
  const before = checked.length;
  const grants = uploads.length;
  for (const response of [await complete(awaitingPhoto, 'A'), await prepare(awaitingPhoto, 'A')]) {
    assert.deepEqual(await response.json(), { role: 'original', availability: 'available' });
  }
  assert.equal((await prepare(awaitingPhoto, 'A', { ...uploadMetadata, width: 801 })).status, 409);
  assert.equal(checked.length, before);
  assert.equal(uploads.length, grants);
  const { rows: [{ count }] } = await operator.query(`
    SELECT count(*)::int AS count FROM cheapo.price_photo
    WHERE household_id = $1 AND observation_id = $2
  `, [household, 'restored-' + awaitingPhoto]);
  assert.equal(count, 1);
  await assert.rejects(runtime.query('UPDATE cheapo.price_photo SET sha256 = sha256'), { code: '42501' });
  await assert.rejects(runtime.query('DELETE FROM cheapo.price_photo'), { code: '42501' });
});

test('retains the original and the selected crop as separate evidence', async () => {
  const crop = { sha256: '4'.repeat(64), byteCount: 1200, width: 400, height: 300 };
  assert.equal((await prepare(awaitingPhoto, 'A', crop, 'crop')).status, 200);
  const base = { role: 'original', width: 800, height: 600 };
  const selected = { role: 'crop', width: 400, height: 300 };
  assert.deepEqual(await visiblePhotos(awaitingPhoto, 'crop'), [base, { ...selected, availability: 'pending' }]);
  assert.deepEqual(await (await complete(awaitingPhoto, 'A', 'crop')).json(), {
    role: 'crop', availability: 'available',
  });
  assert.deepEqual(await visiblePhotos(awaitingPhoto, 'crop'), [base, selected]);
  assert.equal((await photo(awaitingPhoto, 'original', 'B')).status, 200);
  assert.equal((await photo(awaitingPhoto, 'crop', 'B')).status, 200);
});

test('keeps pending and verified evidence reachable while a price is recorded in error', async () => {
  const id = '19000000-0000-4000-8000-000000000026';
  await operator.query(`
    INSERT INTO cheapo.price_observation (household_id, shopper_id, id, resource_id, captured_at, status)
    VALUES ($1, $2, 'needs-review', $3, statement_timestamp(), 'complete')
  `, [household, owner, id]);
  const route = '/v1/me/price-observations';
  const send = (actor: string, path: string, body?: object) => api(new Request('http://localhost' + path, {
    method: body ? 'PATCH' : 'GET',
    headers: { Authorization: `Bearer ${token(actor)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }));

  assert.equal((await prepare(id, 'A')).status, 200);
  assert.equal((await send('B', route + '/' + id, {
    operationId: 'peer-marks-error', action: 'record_in_error', expectedVersion: 1, reason: 'Wrong shelf label',
  })).status, 200);
  assert.deepEqual(await visiblePhotos(id), [{ role: 'original', width: 800, height: 600, availability: 'pending' }]);
  const ordinary = await (await send('B', route)).json() as { observations: { id: string }[] };
  assert(!ordinary.observations.some(observation => observation.id === id));

  objectStatus = 'verified';
  assert.deepEqual(await (await complete(id, 'A')).json(), { role: 'original', availability: 'available' });
  assert.deepEqual(await visiblePhotos(id), [{ role: 'original', width: 800, height: 600 }]);
  assert.equal((await photo(id, 'original', 'B')).status, 200);
  assert.equal((await send('C', route + '/' + id)).status, 404);
  assert.equal((await send('A', route + '/' + id, {
    operationId: 'owner-undoes-error', action: 'undo_recorded_in_error', expectedVersion: 2,
  })).status, 200);
  const restored = await (await send('A', route)).json() as { observations: { id: string; ownedByCurrentShopper: boolean }[] };
  assert.equal(restored.observations.find(observation => observation.id === id)?.ownedByCurrentShopper, true);
  const peerView = await (await send('B', route + '/' + id)).json() as { observation: { ownedByCurrentShopper: boolean } };
  assert.equal(peerView.observation.ownedByCurrentShopper, false);
});

test('versions a pending re-crop with the reviewed fields without altering append or evidence receipts', async () => {
  const route = '/v1/me/price-observations';
  const send = (actor: string, suffix: string, method = 'GET', body?: object) => api(new Request('http://localhost' + route + suffix, {
    method,
    headers: { Authorization: `Bearer ${token(actor)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }));
  await operator.query("INSERT INTO cheapo.shop (id, name) VALUES ('recrop-market', 'Re-crop Market')");
  await operator.query("INSERT INTO cheapo.household_saved_shop (household_id, shop_id) VALUES ($1, 'recrop-market')", [household]);
  const append = {
    sourceId: 'recrop-queued-without-evidence', capturedAt: '2026-01-02T09:30:00.123456Z',
    shopId: 'recrop-market', shopDisplayName: 'Re-crop Market',
    review: { productName: 'Label oats', price: '3.10', currency: 'GBP' },
  };
  const created = await send('A', '', 'POST', append);
  assert.equal(created.status, 201);
  const receipt = await created.json() as { id: string; version: number };
  const path = '/' + receipt.id;
  const cropBox = { left: 0.17, top: 0.31, right: 0.79, bottom: 0.64 };
  const edit = { action: 'correct', operationId: 'recrop-1', expectedVersion: 1,
    review: { ...append.review, price: '3.25' }, photoSelection: { role: 'crop', cropBox } };
  assert.equal((await send('C', path, 'PATCH', edit)).status, 404);
  assert.equal((await send('B', path, 'PATCH', { ...edit, photoSelection: { role: 'crop', cropBox: { ...cropBox, right: 2 } } })).status, 400);

  const accepted = await send('B', path, 'PATCH', edit);
  assert.equal(accepted.status, 200);
  const pending = priceHistoryDetail.parse(await accepted.json()).observation;
  assert.deepEqual([pending.version, pending.priceAmount, pending.cropSource, pending.cropBox, pending.selectedPhotoRole, pending.photos],
    [2, '3.25', 'original', cropBox, null, []]);

  assert.equal((await prepare(receipt.id, 'A')).status, 200);
  const declared = priceHistoryDetail.parse(await (await send('B', path)).json()).observation;
  assert.equal(declared.selectedPhotoRole, 'crop');
  assert.deepEqual(declared.photos, [{ role: 'original', width: 800, height: 600, availability: 'pending' }]);
  assert.equal((await photo(receipt.id, 'original', 'B')).status, 404);

  objectStatus = 'verified';
  assert.deepEqual(await (await complete(receipt.id, 'A')).json(), { role: 'original', availability: 'available' });
  const available = priceHistoryDetail.parse(await (await send('B', path)).json()).observation;
  assert.deepEqual(available.photos, [{ role: 'original', width: 800, height: 600 }]);
  assert.equal(available.selectedPhotoRole, 'crop');
  assert.deepEqual(available.cropBox, cropBox);
  assert.equal((await photo(receipt.id, 'original', 'B')).status, 200);
  assert.equal((await photo(receipt.id, 'crop', 'B')).status, 404);

  const unchanged = await send('B', path, 'PATCH', { action: 'correct', operationId: 'recrop-2', expectedVersion: 2,
    review: { ...append.review, price: '3.30' } });
  assert.equal(unchanged.status, 200);
  const stillCrop = priceHistoryDetail.parse(await unchanged.json()).observation;
  assert.deepEqual([stillCrop.version, stillCrop.cropSource, stillCrop.cropBox, stillCrop.selectedPhotoRole],
    [3, 'original', cropBox, 'crop']);
  assert.deepEqual(await (await send('B', path, 'PATCH', edit)).json(), { observation: pending });
  assert.equal((await send('B', path, 'PATCH', { ...edit, photoSelection: { role: 'original' } })).status, 409);
  const reverted = await send('B', path, 'PATCH', { ...edit, operationId: 'recrop-3', expectedVersion: 3,
    photoSelection: { role: 'original' } });
  assert.equal(reverted.status, 200);
  const restored = priceHistoryDetail.parse(await reverted.json()).observation;
  assert.deepEqual([restored.version, restored.cropSource, restored.cropBox, restored.selectedPhotoRole],
    [4, 'original', null, 'original']);

  const replay = await send('A', '', 'POST', append);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), receipt);
  const { rows: [audit] } = await operator.query(`
    SELECT before_state->>'selectedPhotoRole' AS "beforeRole", after_state->>'cropSource' AS "afterSource"
    FROM cheapo.price_observation_revision WHERE resource_id = $1 AND version = 2
  `, [receipt.id]);
  assert.deepEqual(audit, { beforeRole: null, afterSource: 'original' });
});

test('retains immutable imported original and crop references while choosing a new derived crop', async () => {
  const source = 'restored-' + completed;
  const physical = async () => (await operator.query(`
    SELECT role, storage_key, sha256, byte_count, width, height FROM cheapo.price_photo
    WHERE household_id = $1 AND shopper_id = $2 AND observation_id = $3 ORDER BY role
  `, [household, owner, source])).rows;
  const before = await physical();
  assert.equal(before.length, 2);
  const response = await api(new Request('http://localhost/v1/me/price-observations/' + completed, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token('B')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'correct', operationId: 'recrop-existing', expectedVersion: 1,
      review: { productName: 'Restored oats', price: '2.75', currency: 'GBP' },
      photoSelection: { role: 'crop', cropBox: { left: 0.12, top: 0.38, right: 0.82, bottom: 0.78 } },
    }),
  }));
  assert.equal(response.status, 200);
  const { observation } = priceHistoryDetail.parse(await response.json());
  assert.deepEqual([observation.selectedPhotoRole, observation.cropSource], ['crop', 'original']);
  assert.deepEqual(observation.photos, [{ role: 'original', width: 800, height: 600 }, { role: 'crop', width: 400, height: 300 }]);
  assert.deepEqual(await physical(), before);
});
