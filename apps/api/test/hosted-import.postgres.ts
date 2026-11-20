import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { Pool } from 'pg';

import { hostedImportPostgres } from '../hosted-import-postgres.ts';

const unix = process.env.CHEAPO_TEST_PG_SOCKET;
if (!unix) throw new Error('Run with pnpm --filter @cheapo/api test:postgres.');
const tcpPort = Number(process.env.CHEAPO_TEST_PG_PORT);

test('verifies the database certificate name through a loopback forward to real PostgreSQL', async t => {
  const proxy = createServer(client => {
    const upstream = createConnection(tcpPort, '127.0.0.1');
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.pipe(upstream).pipe(client);
  }).listen(0, '127.0.0.1');
  t.after(() => new Promise<void>(resolve => proxy.close(() => resolve())));
  await once(proxy, 'listening');
  const listener = proxy.address();
  assert(listener && typeof listener === 'object');
  const env = {
    PGHOST: 'db.cheapo.test', PGPORT: String(listener.port), PGUSER: 'cheapo_test', PGDATABASE: 'postgres',
    PGPASSWORD: (await readFile(join(unix, 'password'), 'utf8')).trim(), PGSSLROOTCERT: join(unix, 'data', 'server.crt'),
    CHEAPO_IMPORT_TUNNEL_HOST: '127.0.0.1', PGSSLMODE: 'disable',
  };
  const trusted = new Pool(await hostedImportPostgres(env));
  try {
    const { rows } = await trusted.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
    assert.deepEqual(rows, [{ ssl: true }]);
  } finally {
    await trusted.end();
  }
  const wrongName = new Pool(await hostedImportPostgres({ ...env, PGHOST: 'other.cheapo.test' }));
  try {
    await assert.rejects(wrongName.query('SELECT 1'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  } finally {
    await wrongName.end();
  }
  await assert.rejects(hostedImportPostgres({ ...env, PGSSLROOTCERT: undefined }), /root certificate/);
});
