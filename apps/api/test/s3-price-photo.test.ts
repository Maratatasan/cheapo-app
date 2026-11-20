import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HeadObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3';

import { signS3PhotoUpload, signS3PricePhoto, verifyS3PhotoObject } from '../s3-price-photo.ts';

test('signs an HTTPS GET for exactly one existing object with private cache policy and one minute expiry', async () => {
  const client = new S3Client({
    region: 'eu-west-2',
    credentials: { accessKeyId: 'fixture-id', secretAccessKey: 'fixture-only' },
  });
  try {
    const signer = signS3PricePhoto(client, 'cheapo-fixture');
    const photo = 'shopping-import/first/second/photo.jpg';
    const url = new URL(await signer(photo));
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'cheapo-fixture.s3.eu-west-2.amazonaws.com');
    assert.equal(url.pathname, '/' + photo);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
    assert.equal(url.searchParams.get('response-cache-control'), 'private, no-store');
    assert(url.searchParams.has('X-Amz-Signature'));
  } finally {
    client.destroy();
  }
});

test('binds a conditional JPEG PUT to the expected length and SHA-256', async () => {
  const client = new S3Client({
    region: 'eu-west-2',
    credentials: { accessKeyId: 'fixture-id', secretAccessKey: 'fixture-only' },
  });
  try {
    const upload = signS3PhotoUpload(client, 'cheapo-fixture');
    const checksum = '7'.repeat(64);
    const key = 'price-evidence/home/observation/original/' + checksum + '.jpg';
    const { url: target, headers } = await upload(key, { sha256: checksum, byteCount: 2200, width: 800, height: 600 });
    const url = new URL(target);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.pathname, '/' + key);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '120');
    assert.equal(url.searchParams.get('x-amz-checksum-sha256'), null);
    const signedHeaders = url.searchParams.get('X-Amz-SignedHeaders')?.split(';') ?? [];
    for (const header of ['content-length', 'content-type', 'if-none-match', 'x-amz-checksum-sha256']) {
      assert(signedHeaders.includes(header), 'Missing signed header: ' + header);
    }
    assert.deepEqual(headers, {
      'Content-Length': '2200',
      'Content-Type': 'image/jpeg',
      'If-None-Match': '*',
      'x-amz-checksum-sha256': Buffer.from(checksum, 'hex').toString('base64'),
    });
  } finally {
    client.destroy();
  }
});

test('verifies storage checksum, length, and content type without downloading bytes', async () => {
  const photo = { sha256: '7'.repeat(64), byteCount: 2200, width: 800, height: 600 };
  const key = 'price-evidence/fixture/original/photo.jpg';
  const signal = AbortSignal.timeout(50_000);
  const metadata = {
    ChecksumSHA256: Buffer.from(photo.sha256, 'hex').toString('base64'),
    ContentLength: photo.byteCount,
    ContentType: 'image/jpeg',
  };
  let object: Partial<typeof metadata> = metadata;
  let statusCode = 200;
  const client = { send: async (command: HeadObjectCommand, options: { abortSignal: AbortSignal }) => {
    assert(command instanceof HeadObjectCommand);
    assert.deepEqual(command.input, { Bucket: 'cheapo-fixture', Key: key, ChecksumMode: 'ENABLED' });
    assert.equal(options.abortSignal, signal);
    if (statusCode !== 200) throw new S3ServiceException({
      name: 'FixtureFailure', $fault: 'client', $metadata: { httpStatusCode: statusCode },
    });
    return object;
  } } as Pick<S3Client, 'send'>;

  const verify = verifyS3PhotoObject(client, 'cheapo-fixture');
  assert.equal(await verify(key, photo, signal), 'verified');
  for (const fields of [{ ChecksumSHA256: 'wrong' }, { ContentLength: 1 }, { ContentType: 'text/plain' }]) {
    object = { ...metadata, ...fields };
    assert.equal(await verify(key, photo, signal), 'mismatch');
  }
  object = { ContentLength: 2200, ContentType: 'image/jpeg' };
  assert.equal(await verify(key, photo, signal), 'mismatch');
  for (const failure of [403, 404]) {
    statusCode = failure;
    assert.equal(await verify(key, photo, signal), 'missing');
  }
  statusCode = 429;
  await assert.rejects(verify(key, photo, signal), { name: 'FixtureFailure' });
});
