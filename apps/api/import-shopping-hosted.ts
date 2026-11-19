import { S3Client } from '@aws-sdk/client-s3';
import { Pool } from 'pg';
import { z } from 'zod';

import { hostedImportPostgres } from './hosted-import-postgres.ts';
import { s3ImportPhotos } from './s3-import-photos.ts';
import { planShoppingImport } from './shopping-import-plan.ts';
import { applyShoppingImport } from './shopping-import.ts';

const args = z.tuple([z.string().min(1), z.uuid(), z.uuid()]).safeParse(process.argv.slice(2));
const settings = z.object({
  AWS_REGION: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/),
  CHEAPO_IMPORT_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  CHEAPO_IMPORT_BUCKET_OWNER: z.string().regex(/^\d{12}$/),
}).safeParse(process.env);

if (!args.success || !settings.success) {
  console.error('Pass backup directory, household UUID and shopper UUID. Set AWS_REGION and the intended S3 bucket and owner.');
  process.exitCode = 1;
} else {
  const [backup, householdId, shopperId] = args.data;
  try {
    const plan = await planShoppingImport(backup);
    const connection = await hostedImportPostgres(process.env);
    const pool = new Pool(connection);
    const client = new S3Client({ region: settings.data.AWS_REGION, ignoreConfiguredEndpointUrls: true });
    try {
      const ensurePhoto = await s3ImportPhotos(client, backup, {
        bucket: settings.data.CHEAPO_IMPORT_BUCKET,
        expectedBucketOwner: settings.data.CHEAPO_IMPORT_BUCKET_OWNER,
        householdId,
        shopperId,
      });
      const report = await applyShoppingImport(pool, { householdId, shopperId }, plan, ensurePhoto);
      console.log(JSON.stringify(report, null, 2));
    } catch {
      console.error('Hosted restore could not confirm a commit. Verify the database target, membership, S3 permissions, and existing records before retrying.');
      process.exitCode = 1;
    } finally {
      client.destroy();
      await pool.end();
    }
  } catch (cause) {
    const message = cause instanceof Error && !('code' in cause) ? cause.message : 'Could not prepare the hosted restore.';
    console.error(message);
    process.exitCode = 1;
  }
}
