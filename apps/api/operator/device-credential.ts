import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';

import { credentialDigest, generateCredential } from '../credential.ts';

async function revoke(database: Pool, id: string): Promise<boolean> {
  const result = await database.query(`
    UPDATE cheapo.shopper_credential
    SET revoked_at = COALESCE(revoked_at, statement_timestamp())
    WHERE id = $1
  `, [id]);
  return result.rowCount === 1;
}

async function issue(database: Pool, householdId: string, shopperId: string, expiresAt: string) {
  const directory = await mkdtemp(join(tmpdir(), 'cheapo-device-'));
  const deliveryFile = join(directory, 'credential.txt');
  const credential = generateCredential();
  let credentialId: string | undefined;
  let delivered = false;

  try {
    const { rows } = await database.query<{ id: string }>(`
      INSERT INTO cheapo.shopper_credential (token_digest, household_id, shopper_id, expires_at)
      SELECT $1, household_id, shopper_id, $4
      FROM cheapo.household_membership
      WHERE household_id = $2 AND shopper_id = $3 AND revoked_at IS NULL
        AND $4::timestamptz > statement_timestamp()
      FOR SHARE
      RETURNING id
    `, [credentialDigest(credential), householdId, shopperId, expiresAt]);

    credentialId = rows[0]?.id;
    if (!credentialId) {
      console.error('Issuing a credential requires an active membership and a future expiry.');
      process.exitCode = 1;
      return;
    }

    await writeFile(deliveryFile, `${credential}\n`, { mode: 0o600, flag: 'wx' });
    delivered = true;
  } catch {
    if (credentialId) {
      try {
        await revoke(database, credentialId);
      } catch {
        console.error(`Delivery failed. Revoke credential ${credentialId} before trying again.`);
      }
    }
    throw new Error('Credential issuance failed.');
  } finally {
    if (!delivered) await rm(directory, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ credentialId, deliveryFile }));
}

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

async function main([command, first, second, third, ...extra]: string[]) {
  const issuing = command === 'issue' && uuid.test(first ?? '') && uuid.test(second ?? '')
    && isoUtc.test(third ?? '') && Number.isFinite(Date.parse(third)) && extra.length === 0;
  const revoking = command === 'revoke' && uuid.test(first ?? '') && second === undefined;
  if (!issuing && !revoking) {
    console.error('Usage: issue <household UUID> <shopper UUID> <UTC expiry> | revoke <credential UUID>');
    process.exitCode = 1;
    return;
  }

  const database = new Pool();
  try {
    if (issuing) {
      await issue(database, first, second, third);
    } else if (await revoke(database, first)) {
      console.log(JSON.stringify({ credentialId: first, revoked: true }));
    } else {
      console.error('Credential ID was not found.');
      process.exitCode = 1;
    }
  } finally {
    await database.end();
  }
}

try {
  await main(process.argv.slice(2));
} catch {
  console.error('Credential command failed. Check the database connection, migrations, and delivery directory.');
  process.exitCode = 1;
}
