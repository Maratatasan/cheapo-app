import { importedEvidenceKey, newEvidenceKey } from './evidence-key.ts';
import { readShoppingMember, type ShoppingTransaction } from './postgres-shopping.ts';
import type { CompletePhotoUpload, PhotoUploadDetails, PreparePhotoUpload, VerifyPhotoObject } from './price-photo-upload.ts';

export function postgresPhotoUpload(transaction: ShoppingTransaction): PreparePhotoUpload {
  return (digest, resourceId, role, photo) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };

    const key = newEvidenceKey(member.household_id, resourceId, role, photo.sha256);
    const { rows: [observation] } = await query<{ id: string; attachedKey: string | null; matches: boolean | null }>(`
      SELECT observation.id, photo.storage_key AS "attachedKey",
        (photo.sha256, photo.byte_count, photo.width, photo.height) = ($5::text, $6::int, $7::int, $8::int) AS matches
      FROM cheapo.price_observation AS observation
      LEFT JOIN cheapo.price_photo AS photo
        ON (photo.household_id, photo.shopper_id, photo.observation_id) =
          (observation.household_id, observation.shopper_id, observation.id)
          AND photo.role = $4
      WHERE observation.resource_id = $1::uuid AND observation.household_id = $2::uuid
        AND observation.shopper_id = $3::uuid AND observation.status = 'complete'
        AND observation.source_test_shop IS NOT TRUE
    `, [resourceId, member.household_id, member.shopper_id, role, photo.sha256, photo.byteCount, photo.width, photo.height]);
    if (!observation) return { status: 'not_found' };
    if (observation.attachedKey) {
      const imported = importedEvidenceKey(member.household_id, member.shopper_id, photo.sha256);
      const matches = observation.matches && (observation.attachedKey === key || observation.attachedKey === imported);
      return { status: matches ? 'available' : 'conflict' };
    }

    const scope = [member.household_id, member.shopper_id, observation.id, role];
    await query(`
      INSERT INTO cheapo.price_photo_upload (household_id, shopper_id, observation_id, role, sha256, byte_count, width, height)
      VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::int, $7::int, $8::int)
      ON CONFLICT (household_id, shopper_id, observation_id, role) DO NOTHING
    `, [...scope, photo.sha256, photo.byteCount, photo.width, photo.height]);

    const { rows: [saved] } = await query<{ matches: boolean }>(`
      SELECT (sha256, byte_count, width, height) = ($5::text, $6::int, $7::int, $8::int) AS matches
      FROM cheapo.price_photo_upload
      WHERE household_id = $1::uuid AND shopper_id = $2::uuid AND observation_id = $3 AND role = $4
    `, [...scope, photo.sha256, photo.byteCount, photo.width, photo.height]);
    if (!saved?.matches) return { status: 'conflict' };
    return { status: 'pending', key };
  });
}

type PendingEvidence = PhotoUploadDetails & {
  sourceId: string; attachedKey: string | null; attachedMatches: boolean | null;
};

export function postgresCompletePhotoUpload(
  transaction: ShoppingTransaction, verify: VerifyPhotoObject,
): CompletePhotoUpload {
  return async (digest, resourceId, role) => {
    // Include database wake time in the deadline. Leave the transaction time to commit or roll back.
    const deadline = AbortSignal.timeout(23_000);
    return transaction(async query => {
      const member = await readShoppingMember(query, digest);
      if (!member) return { status: 'unauthenticated' };
      if (!member.active) return { status: 'forbidden' };
      const { rows: [pending] } = await query<PendingEvidence>(`
        SELECT pending.observation_id AS "sourceId", pending.sha256, pending.byte_count AS "byteCount",
          pending.width, pending.height, photo.storage_key AS "attachedKey",
          (photo.sha256, photo.byte_count, photo.width, photo.height) =
            (pending.sha256, pending.byte_count, pending.width, pending.height) AS "attachedMatches"
        FROM cheapo.price_observation AS observation
        JOIN cheapo.price_photo_upload AS pending
          ON (pending.household_id, pending.shopper_id, pending.observation_id) =
            (observation.household_id, observation.shopper_id, observation.id) AND pending.role = $4
        LEFT JOIN cheapo.price_photo AS photo
          ON (photo.household_id, photo.shopper_id, photo.observation_id, photo.role) =
            (pending.household_id, pending.shopper_id, pending.observation_id, pending.role)
        WHERE observation.resource_id = $1::uuid AND observation.household_id = $2::uuid
          AND observation.shopper_id = $3::uuid AND observation.status = 'complete'
          AND observation.source_test_shop IS NOT TRUE
      `, [resourceId, member.household_id, member.shopper_id, role]);
      if (!pending) return { status: 'not_found' };

      const key = newEvidenceKey(member.household_id, resourceId, role, pending.sha256);
      if (pending.attachedKey) {
        return { status: pending.attachedKey === key && pending.attachedMatches ? 'available' : 'conflict' };
      }
      const result = await verify(key, pending, AbortSignal.any([deadline, AbortSignal.timeout(3_000)]));
      if (result !== 'verified') return { status: result === 'missing' ? 'pending' : 'mismatch' };

      const scope = [member.household_id, member.shopper_id, pending.sourceId, role];
      const { rows: [inserted] } = await query<{ key: string }>(`
        INSERT INTO cheapo.price_photo (household_id, shopper_id, observation_id, role,
          storage_key, sha256, byte_count, width, height)
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::bigint, $8::int, $9::int)
        ON CONFLICT (household_id, shopper_id, observation_id, role) DO NOTHING
        RETURNING storage_key AS key
      `, [...scope, key, pending.sha256, pending.byteCount, pending.width, pending.height]);
      if (inserted) return { status: 'available' };

      const { rows: [attached] } = await query<{ key: string }>(`
        SELECT storage_key AS key FROM cheapo.price_photo
        WHERE household_id = $1::uuid AND shopper_id = $2::uuid AND observation_id = $3 AND role = $4
          AND storage_key = $5 AND (sha256, byte_count, width, height) = ($6::text, $7::bigint, $8::int, $9::int)
      `, [...scope, key, pending.sha256, pending.byteCount, pending.width, pending.height]);
      return { status: attached?.key === key ? 'available' : 'conflict' };
    });
  };
}
