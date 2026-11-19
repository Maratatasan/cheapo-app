import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3ServiceException, type S3Client } from '@aws-sdk/client-s3';

import type { planShoppingImport } from './shopping-import-plan.ts';

type Photo = Awaited<ReturnType<typeof planShoppingImport>>['photos'][number];
type Target = { bucket: string; expectedBucketOwner: string; householdId: string; shopperId: string };

export async function s3ImportPhotos(client: Pick<S3Client, 'send'>, backupDirectory: string, target: Target) {
  const backup = await realpath(backupDirectory);
  const prefix = `shopping-import/${target.householdId}/${target.shopperId}`;

  return async (photo: Photo): Promise<string> => {
    const key = `${prefix}/${photo.sha256}.jpg`;
    const object = { Bucket: target.bucket, Key: key, ExpectedBucketOwner: target.expectedBucketOwner };
    const source = join(backup, photo.path);
    if (await realpath(source) !== source) throw new Error('A source photo moved after the backup was checked.');
    const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const entry = await file.stat();
      if (!entry.isFile() || entry.size !== photo.bytes) throw new Error('Price photo size does not match the backup.');
      const stream = file.createReadStream({ autoClose: false });
      try {
        await client.send(new PutObjectCommand({
          ...object,
          Body: stream,
          ContentLength: photo.bytes,
          ContentType: 'image/jpeg',
          ChecksumSHA256: Buffer.from(photo.sha256, 'hex').toString('base64'),
          IfNoneMatch: '*',
        }));
      } catch (cause) {
        // An existing object is reusable only after checking its bytes below.
        if (!(cause instanceof S3ServiceException) || cause.$metadata.httpStatusCode !== 412) throw cause;
      } finally {
        stream.destroy();
      }
    } finally {
      await file.close();
    }

    const result = await client.send(new GetObjectCommand(object));
    if (!(result.Body instanceof Readable)) throw new Error('Could not read the saved price photo.');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of result.Body) {
      bytes += chunk.length;
      if (bytes > photo.bytes) throw new Error('Saved price photo is larger than the backup.');
      hash.update(chunk);
    }
    if (bytes !== photo.bytes || hash.digest('hex') !== photo.sha256) {
      throw new Error('Saved price photo does not match the backup.');
    }
    return key;
  };
}
