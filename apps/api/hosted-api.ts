import { S3Client } from '@aws-sdk/client-s3';

import { json } from './api-http.ts';
import { createGatewayHandler } from './hosted-http.ts';
import { createShoppingApi } from './local-api.ts';
import { createRdsDataDatabase } from './rds-data.ts';
import { signS3PricePhoto } from './s3-price-photo.ts';

const {
  CHEAPO_AWS_CLUSTER_ARN: resourceArn,
  CHEAPO_AWS_RUNTIME_SECRET_ARN: secretArn,
  CHEAPO_AWS_DB_NAME: database,
  CHEAPO_AWS_PHOTO_BUCKET: photoBucket,
} = process.env;
const photoSigner = photoBucket ? signS3PricePhoto(new S3Client({}), photoBucket) : undefined;
const api = resourceArn && secretArn && database
  ? createShoppingApi(createRdsDataDatabase({ resourceArn, secretArn, database }), photoSigner)
  : async () => json({ error: 'service_unavailable' }, 503);

export const handler = createGatewayHandler(api);
