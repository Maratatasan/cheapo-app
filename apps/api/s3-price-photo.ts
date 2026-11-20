import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { photoReadLifetimeSeconds, type SignPricePhoto } from './price-photo.ts';
import { photoUploadLifetimeSeconds, type SignPhotoUpload } from './price-photo-upload.ts';

export function signS3PricePhoto(client: S3Client, bucket: string): SignPricePhoto {
  return key => getSignedUrl(client, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseCacheControl: 'private, no-store',
  }), { expiresIn: photoReadLifetimeSeconds });
}

export function signS3PhotoUpload(client: S3Client, bucket: string): SignPhotoUpload {
  return async (key, photo) => {
    const checksum = Buffer.from(photo.sha256, 'hex').toString('base64');
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentLength: photo.byteCount,
      ContentType: 'image/jpeg',
      ChecksumSHA256: checksum,
      IfNoneMatch: '*',
    });
    const url = await getSignedUrl(client, command, {
      expiresIn: photoUploadLifetimeSeconds,
      signableHeaders: new Set(['content-length', 'content-type', 'if-none-match']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    });
    return { url, headers: {
      'Content-Length': String(photo.byteCount),
      'Content-Type': 'image/jpeg',
      'If-None-Match': '*',
      'x-amz-checksum-sha256': checksum,
    } };
  };
}
