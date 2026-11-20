import { isAbsolute } from 'node:path';
import { Pool } from 'pg';
import { z } from 'zod';

import { localImportPhotos } from './local-import-photos.ts';
import { planShoppingImport } from './shopping-import-plan.ts';
import { applyShoppingImport } from './shopping-import.ts';

const args = z.tuple([z.string().min(1), z.string().min(1), z.uuid(), z.uuid()]).safeParse(process.argv.slice(2));
const host = process.env.PGHOST;
const database = process.env.PGDATABASE;
const user = process.env.PGUSER;

if (!args.success || !host || !isAbsolute(host) || !database || !user) {
  console.error('Pass backup directory, private asset directory, household UUID and shopper UUID. Set PGHOST to the local PostgreSQL socket directory and set PGDATABASE and PGUSER explicitly.');
  process.exitCode = 1;
} else {
  const [backup, assets, householdId, shopperId] = args.data;
  // Prepare and validate everything readable before making a database connection.
  try {
    const plan = await planShoppingImport(backup);
    const ensurePhoto = await localImportPhotos(backup, assets);
    const pool = new Pool({ host, database, user, ssl: false });
    try {
      const report = await applyShoppingImport(pool, { householdId, shopperId }, plan, ensurePhoto);
      console.log(JSON.stringify(report, null, 2));
    } catch (cause) {
      const message = cause instanceof Error && !('code' in cause) ? cause.message : 'PostgreSQL did not commit the restore.';
      console.error(message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  } catch (cause) {
    const message = cause instanceof Error && !('code' in cause) ? cause.message : 'Could not prepare the backup or asset directory.';
    console.error(message);
    process.exitCode = 1;
  }
}
