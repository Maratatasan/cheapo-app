import { json } from './api-http.ts';
import { createGatewayHandler } from './hosted-http.ts';
import { createShoppingApi } from './local-api.ts';
import { createRdsDataDatabase } from './rds-data.ts';

const {
  CHEAPO_AWS_CLUSTER_ARN: resourceArn,
  CHEAPO_AWS_RUNTIME_SECRET_ARN: secretArn,
  CHEAPO_AWS_DB_NAME: database,
} = process.env;
const api = resourceArn && secretArn && database
  ? createShoppingApi(createRdsDataDatabase({ resourceArn, secretArn, database }))
  : async () => json({ error: 'service_unavailable' }, 503);

export const handler = createGatewayHandler(api);
