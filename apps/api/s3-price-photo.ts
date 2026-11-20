import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { photoReadLifetimeSeconds, type SignPricePhoto } from './price-photo.ts';

export function signS3PricePhoto(client: S3Client, bucket: string): SignPricePhoto {
  return key => getSignedUrl(client, new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ResponseCacheControl: 'private, no-store',
  }), { expiresIn: photoReadLifetimeSeconds });
}
