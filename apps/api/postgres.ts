import { readShoppingMember, type ShoppingQuery, type ShoppingTransaction } from './postgres-shopping.ts';

import type { ComparisonBasis, ExecutePreference, PreferenceAction, PreferenceResult } from './preferences.ts';

type CurrentPreference = { basis: ComparisonBasis | null; version: number };

async function readPreference(query: ShoppingQuery, digest: string, group: string): Promise<PreferenceResult> {
  const { rows: [result] } = await query<PreferenceResult>(`
    WITH credential AS (
      SELECT shopper_id, active FROM cheapo.resolve_shopping_member($1, false)
    ), member AS (
      SELECT shopper_id FROM credential WHERE active
    ), preference AS (
      SELECT preference.basis, preference.record_version
      FROM cheapo.comparison_preference AS preference
      JOIN member USING (shopper_id)
      WHERE preference.product_group_id = $2
    )
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM member) THEN 'ok'
      WHEN EXISTS (SELECT 1 FROM credential) THEN 'forbidden'
      ELSE 'unauthenticated'
    END AS status, (SELECT basis FROM preference) AS basis,
      coalesce((SELECT record_version FROM preference), 0) AS version
  `, [digest, group]);
  return result;
}

async function writePreference(
  query: ShoppingQuery, digest: string, group: string, action: Extract<PreferenceAction, { kind: 'write' }>,
): Promise<PreferenceResult> {
  const member = await readShoppingMember(query, digest);
  if (!member) return { status: 'unauthenticated' };
  if (!member.active) return { status: 'forbidden' };
  const shopper = member.shopper_id;
  // The personal preference follows the shopper across active enrollments, including other households.
  await query('SELECT 1 FROM pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))',
    [`cheapo:preference:${shopper}`]);

  const { basis, operation } = action;
  if (operation) {
    const { rows: [receipt] } = await query<CurrentPreference & { matches: boolean }>(`
      SELECT product_group_id = $3 AND operation_request = $4::jsonb AS matches, after_basis AS basis, version
      FROM cheapo.comparison_preference_revision WHERE shopper_id = $1::uuid AND operation_id = $2
    `, [shopper, operation.operationId, group, action]);
    if (receipt) return receipt.matches
      ? { status: 'ok', basis: receipt.basis, version: receipt.version }
      : { status: 'operation_conflict' };
  }

  const { rows: [previous] } = await query<CurrentPreference>(`
    SELECT basis, record_version AS version
    FROM cheapo.comparison_preference WHERE shopper_id = $1::uuid AND product_group_id = $2
  `, [shopper, group]);
  const current = previous ?? { basis: null, version: 0 };
  if (operation && current.version !== operation.expectedVersion) return { status: 'version_conflict', current };
  if (!operation && current.basis === basis) return { status: 'ok', ...current };

  const version = current.version + 1;
  await query(`
    INSERT INTO cheapo.comparison_preference (shopper_id, product_group_id, basis, record_version)
    VALUES ($1::uuid, $2, $3, $4::int)
    ON CONFLICT (shopper_id, product_group_id) DO UPDATE
    SET basis = EXCLUDED.basis, record_version = EXCLUDED.record_version
  `, [shopper, group, basis, version]);
  await query(`
    INSERT INTO cheapo.comparison_preference_revision
      (shopper_id, product_group_id, version, household_id, operation_id, operation_request, before_basis, after_basis)
    VALUES ($1::uuid, $2, $3::int, $4::uuid, $5, $6::jsonb, $7, $8)
  `, [shopper, group, version, member.household_id, operation?.operationId ?? null, action, current.basis, basis]);
  return { status: 'ok', basis, version };
}

export function postgresPreferences({ query, transaction }: { query: ShoppingQuery; transaction: ShoppingTransaction }): ExecutePreference {
  return (digest, group, action) => action.kind === 'read'
    ? readPreference(query, digest, group)
    : transaction(writeQuery => writePreference(writeQuery, digest, group, action));
}
