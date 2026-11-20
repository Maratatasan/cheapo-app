import assert from 'node:assert/strict';
import { test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';

import { signS3PricePhoto } from '../s3-price-photo.ts';

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
