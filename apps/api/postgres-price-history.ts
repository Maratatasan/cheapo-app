import { readShoppingMember, type ShoppingMember, type ShoppingQuery, type ShoppingTransaction } from './postgres-shopping.ts';
import type { ExecutePriceHistory, PriceObservation, PriceObservationDetail } from './price-history.ts';

const observationFields = `
  observation.resource_id::text AS id, observation.id AS "sourceId",
  observation.record_version AS version,
  to_char(observation.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "capturedAt",
  observation.product_id AS "productId", observation.source_product_id AS "sourceProductId",
  coalesce(nullif(btrim(observation.review->>'productName'), ''), observation.source_product_name) AS "productName",
  observation.shop_id AS "shopId", observation.source_shop_id AS "sourceShopId",
  observation.shop_display_name AS "shopDisplayName",
  observation.price_amount::text AS "priceAmount", observation.currency,
  observation.review, observation.unit_price AS "unitPrice",
  observation.recorded_in_error_reason AS "errorReason",
  COALESCE((
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'role', evidence.role, 'width', evidence.width, 'height', evidence.height,
      'availability', evidence.availability)) ORDER BY evidence.role DESC)
    FROM (
      SELECT photo.role, photo.width, photo.height, NULL::text AS availability
      FROM cheapo.price_photo AS photo
      WHERE (photo.household_id, photo.shopper_id, photo.observation_id) =
        (observation.household_id, observation.shopper_id, observation.id)
      UNION ALL
      SELECT pending.role, pending.width, pending.height, 'pending'::text
      FROM cheapo.price_photo_upload AS pending
      WHERE (pending.household_id, pending.shopper_id, pending.observation_id) =
        (observation.household_id, observation.shopper_id, observation.id)
        AND NOT EXISTS (
          SELECT 1 FROM cheapo.price_photo AS photo
          WHERE (photo.household_id, photo.shopper_id, photo.observation_id, photo.role) =
            (pending.household_id, pending.shopper_id, pending.observation_id, pending.role)
        )
    ) AS evidence
  ), '[]'::jsonb) AS photos
`;

const visibleObservations = `
  FROM cheapo.price_observation AS observation
  LEFT JOIN cheapo.product AS product ON product.id = observation.product_id
  WHERE observation.household_id = $1::uuid
    AND observation.status = 'complete' AND observation.source_test_shop IS NOT TRUE
`;

type PriceRow = PriceObservation & { errorReason: string | null };
type DetailRow = PriceRow & { cropBox: PriceObservationDetail['cropBox'] };

export async function readObservationDetail(query: ShoppingQuery, member: ShoppingMember, id: string, lock = false) {
  const { rows: [row] } = await query<DetailRow>(`
    SELECT ${observationFields}, observation.crop_box AS "cropBox",
      observation.shopper_id = $3::uuid AS "ownedByCurrentShopper"
    ${visibleObservations}
    AND observation.resource_id = $2::uuid
    ${lock ? 'FOR UPDATE OF observation' : ''}
  `, [member.household_id, id, member.shopper_id]);
  if (!row) return undefined;
  const { errorReason, ...detail } = row;
  const selectedPhotoRole = detail.photos.find(photo => photo.role === 'crop')?.role ?? detail.photos[0]?.role ?? null;
  return { ...detail, selectedPhotoRole, ...(errorReason ? { recordedInErrorReason: errorReason } : {}) };
}

export function postgresPriceHistory(transaction: ShoppingTransaction): ExecutePriceHistory {
  return (digest, read) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };

    if (read.kind === 'detail') {
      const observation = await readObservationDetail(query, member, read.id);
      return observation ? { status: 'detail', observation } : { status: 'not_found' };
    }

    const { limit, cursor, filters, includeRecordedInError } = read;
    const { rows } = await query<PriceRow>(`
      SELECT ${observationFields}, observation.shopper_id = $10::uuid AS "ownedByCurrentShopper"
      ${visibleObservations}
      AND ($2::timestamptz IS NULL OR (observation.captured_at, observation.resource_id) < ($2::timestamptz, $3::uuid))
      AND ($5::text IS NULL OR observation.product_id = $5)
      AND (
        ($6::text IS NULL AND $7::text IS NULL) OR product.comparable_group_id = $6
        OR (($6::text IS NULL OR product.comparable_group_id IS NULL)
          AND lower(btrim(coalesce(nullif(btrim(observation.review->>'productType'), ''), product.product_type))) = lower($7))
      )
      AND ($8::text IS NULL OR observation.currency = $8)
      AND ($9::boolean OR observation.recorded_in_error_reason IS NULL)
      ORDER BY observation.captured_at DESC, observation.resource_id DESC
      LIMIT $4::int
    `, [member.household_id, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1,
      filters.productId, filters.comparableGroupId, filters.productType, filters.currency, includeRecordedInError, member.shopper_id]);
    return {
      status: 'ok',
      observations: rows.map(({ errorReason, ...observation }) => errorReason
        ? { ...observation, recordedInErrorReason: errorReason }
        : observation),
    };
  });
}
