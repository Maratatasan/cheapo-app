import { readFile } from 'node:fs/promises';
import type { PoolConfig } from 'pg';
import { z } from 'zod';

const connectionSettings = z.object({
  PGHOST: z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i),
  PGPORT: z.coerce.number().int().min(1).max(65_535).default(5432),
  PGDATABASE: z.string().min(1),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().min(1),
  PGSSLROOTCERT: z.string().min(1),
  CHEAPO_IMPORT_TUNNEL_HOST: z.enum(['127.0.0.1', '::1']).optional(),
});

/** Accepts either a direct DNS endpoint or an explicit loopback port forward. */
export async function hostedImportPostgres(env: NodeJS.ProcessEnv): Promise<PoolConfig> {
  const config = connectionSettings.safeParse(env);
  if (!config.success) {
    throw new Error('Set PGHOST to the database DNS name and supply explicit PostgreSQL credentials and root certificate.');
  }
  const settings = config.data;
  const ca = await readFile(settings.PGSSLROOTCERT, 'utf8').catch(() => {
    throw new Error('Could not read the PostgreSQL root certificate.');
  });
  if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('Provide a PostgreSQL root certificate in PEM format.');
  return {
    host: settings.CHEAPO_IMPORT_TUNNEL_HOST ?? settings.PGHOST,
    port: settings.PGPORT,
    database: settings.PGDATABASE,
    user: settings.PGUSER,
    password: settings.PGPASSWORD,
    connectionTimeoutMillis: 60_000,
    ssl: { ca, servername: settings.PGHOST, rejectUnauthorized: true, minVersion: 'TLSv1.2' },
  };
}
