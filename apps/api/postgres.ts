import type { Pool } from 'pg';

import type { ExecutePreference, PreferenceOperation, PreferenceResult } from './preferences.ts';

const operationSql: Record<PreferenceOperation, string> = {
  GET: `
    SELECT preference.basis
    FROM cheapo.comparison_preference AS preference
    JOIN member USING (shopper_id)
    WHERE preference.product_group_id = $2`,
  PUT: `
    INSERT INTO cheapo.comparison_preference (shopper_id, product_group_id, basis)
    SELECT shopper_id, $2, $3 FROM member
    ON CONFLICT (shopper_id, product_group_id) DO UPDATE SET basis = EXCLUDED.basis
    RETURNING basis`,
  DELETE: `
    DELETE FROM cheapo.comparison_preference AS preference
    USING member
    WHERE preference.shopper_id = member.shopper_id AND preference.product_group_id = $2
    RETURNING NULL::text AS basis`,
};

export function postgresPreferences(database: Pool): ExecutePreference {
  return async (tokenDigest, productGroupId, operation, basis) => {
    // Check the credential and membership in the same statement as the read or write.
    const { rows } = await database.query<PreferenceResult>(`
      WITH credential AS (
        SELECT household_id, shopper_id FROM cheapo.shopper_credential
        WHERE token_digest = $1 AND revoked_at IS NULL AND expires_at > statement_timestamp()
      ), member AS (
        SELECT shopper_id FROM credential
        JOIN cheapo.household_membership AS membership USING (household_id, shopper_id)
        WHERE membership.revoked_at IS NULL
      ), preference AS (${operationSql[operation]})
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM member) THEN 'authorized'
        WHEN EXISTS (SELECT 1 FROM credential) THEN 'forbidden'
        ELSE 'unauthenticated'
      END AS access, (SELECT basis FROM preference) AS basis
    `, operation === 'PUT' ? [tokenDigest, productGroupId, basis] : [tokenDigest, productGroupId]);
    return rows[0];
  };
}
