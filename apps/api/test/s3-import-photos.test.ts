import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test, type TestContext } from 'node:test';
import { GetObjectCommand, PutObjectCommand, S3ServiceException, type S3Client } from '@aws-sdk/client-s3';

import { s3ImportPhotos } from '../s3-import-photos.ts';

const target = {
  bucket: 'cheapo-fixture-bucket', expectedBucketOwner: '000000000000',
  householdId: 'household-fixture', shopperId: 'shopper-fixture',
};
const original = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x42]);
const photo = {
  path: 'photos/1/original.jpg', role: 'original' as const, width: 3, height: 3, mimeType: 'image/jpeg' as const,
  observationId: 'observation-fixture', bytes: original.length, sha256: createHash('sha256').update(original).digest('hex'),
};
const key = `shopping-import/${target.householdId}/${target.shopperId}/${photo.sha256}.jpg`;

async function fixture(t: TestContext) {
  const backup = await mkdtemp(join(tmpdir(), 'cheapo-s3-import-fixture-'));
  t.after(() => rm(backup, { recursive: true, force: true }));
  await mkdir(join(backup, 'photos/1'), { recursive: true });
  await writeFile(join(backup, photo.path), original);
  return backup;
}

function mockClient(send: (command: GetObjectCommand | PutObjectCommand) => Promise<unknown>) {
  return { send: send as S3Client['send'] };
}

function exists(status: 412 | 403) {
  return new S3ServiceException({ name: 'FixtureS3Error', $fault: 'client', $metadata: { httpStatusCode: status } });
}

test('sends an owner-checked conditional PUT with the source SHA and verifies streamed readback', async t => {
  const names: string[] = [];
  const client = mockClient(async command => {
    names.push(command.constructor.name);
    assert.deepEqual([command.input.Bucket, command.input.Key, command.input.ExpectedBucketOwner],
      [target.bucket, key, target.expectedBucketOwner]);
    if (command instanceof PutObjectCommand) {
      assert.equal(command.input.IfNoneMatch, '*');
      assert.equal(command.input.ChecksumSHA256, createHash('sha256').update(original).digest('base64'));
      assert.equal(command.input.ContentLength, original.length);
      assert.ok(command.input.Body instanceof Readable);
      assert.deepEqual(Buffer.concat(await command.input.Body.toArray()), original);
      return {};
    }
    return { Body: Readable.from([original.subarray(0, 2), original.subarray(2)]) };
  });
  const ensurePhoto = await s3ImportPhotos(client, await fixture(t), target);
  assert.equal(await ensurePhoto(photo), key);
  assert.deepEqual(names, ['PutObjectCommand', 'GetObjectCommand']);
});

test('reuses an existing object only when identical and never attempts to overwrite a conflict', async t => {
  let readback = original;
  let writes = 0;
  const client = mockClient(async command => {
    if (command instanceof PutObjectCommand) {
      writes += 1;
      throw exists(412);
    }
    return { Body: Readable.from([readback]) };
  });
  const ensurePhoto = await s3ImportPhotos(client, await fixture(t), target);
  assert.equal(await ensurePhoto(photo), key);
  readback = Buffer.alloc(original.length, 1);
  await assert.rejects(ensurePhoto(photo), /does not match the backup/);
  assert.equal(writes, 2);
});

test('propagates denied writes without attempting to read or accept a photo key', async t => {
  const client = mockClient(async command => {
    assert.ok(command instanceof PutObjectCommand);
    throw exists(403);
  });
  const ensurePhoto = await s3ImportPhotos(client, await fixture(t), target);
  await assert.rejects(ensurePhoto(photo), { name: 'FixtureS3Error' });
});
