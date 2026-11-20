import { Pool } from 'pg';

import { createLocalApi } from './local-api.ts';
import { localHttpServer } from './server.ts';

const pool = new Pool({ max: 4, connectionTimeoutMillis: 3_000, statement_timeout: 3_000 });
pool.on('error', () => console.error('An idle PostgreSQL connection closed.'));
const server = localHttpServer(createLocalApi(pool));
server.listen(8787, '127.0.0.1', () => console.log('Cheapo API listening at http://127.0.0.1:8787'));

function stop() {
  server.close(() => void pool.end());
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
