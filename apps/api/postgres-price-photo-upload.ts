import { newEvidenceKey } from './evidence-key.ts';
import { readShoppingMember, type ShoppingTransaction } from './postgres-shopping.ts';
import type { PreparePhotoUpload } from './price-photo-upload.ts';

export function postgresPhotoUpload(transaction: ShoppingTransaction): PreparePhotoUpload {
  return (digest, resourceId, role, photo) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };

    const { rows: [observation] } = await query<{ id: string; available: boolean }>(`
      SELECT observation.id, EXISTS (
        SELECT 1 FROM cheapo.price_photo AS photo
        WHERE (photo.household_id, photo.shopper_id, photo.observation_id) =
          (observation.household_id, observation.shopper_id, observation.id)
          AND photo.role = $4
      ) AS available
      FROM cheapo.price_observation AS observation
      WHERE observation.resource_id = $1::uuid AND observation.household_id = $2::uuid
        AND observation.shopper_id = $3::uuid AND observation.status = 'complete'
        AND observation.source_test_shop IS NOT TRUE
    `, [resourceId, member.household_id, member.shopper_id, role]);
    if (!observation) return { status: 'not_found' };
    if (observation.available) return { status: 'conflict' };

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
    return { status: 'pending', key: newEvidenceKey(member.household_id, resourceId, role, photo.sha256) };
  });
}
