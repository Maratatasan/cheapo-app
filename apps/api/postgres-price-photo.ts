import { importedEvidenceKey, newEvidenceKey } from './evidence-key.ts';
import { readShoppingMember, type ShoppingTransaction } from './postgres-shopping.ts';
import type { ReadPricePhoto } from './price-photo.ts';

type EvidenceRow = {
  householdId: string;
  shopperId: string;
  key: string;
  sha256: string;
  byteCount: string;
  width: number;
  height: number;
};

export function postgresPricePhoto(transaction: ShoppingTransaction): ReadPricePhoto {
  return (digest, observationId, role) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };

    const { rows: [photo] } = await query<EvidenceRow>(`
      SELECT photo.household_id::text AS "householdId", photo.shopper_id::text AS "shopperId",
        photo.storage_key AS key, photo.sha256, photo.byte_count::text AS "byteCount",
        photo.width, photo.height
      FROM cheapo.price_observation AS observation
      JOIN cheapo.price_photo AS photo
        ON (photo.household_id, photo.shopper_id, photo.observation_id) =
           (observation.household_id, observation.shopper_id, observation.id)
      WHERE observation.resource_id = $1::uuid AND observation.household_id = $2::uuid
        AND observation.source_test_shop IS NOT TRUE
        AND (observation.status = 'complete' OR observation.shopper_id = $3::uuid)
        AND photo.role = $4
    `, [observationId, member.household_id, member.shopper_id, role]);

    if (!photo) return { status: 'not_found' };
    const imported = importedEvidenceKey(photo.householdId, photo.shopperId, photo.sha256);
    const captured = newEvidenceKey(photo.householdId, observationId, role, photo.sha256);
    if (photo.key !== imported && photo.key !== captured) return { status: 'not_found' };
    return { status: 'ok', photo };
  });
}
