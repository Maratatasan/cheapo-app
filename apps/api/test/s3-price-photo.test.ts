import assert from 'node:assert/strict';
import { test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';

import { signS3PhotoUpload, signS3PricePhoto } from '../s3-price-photo.ts';

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
