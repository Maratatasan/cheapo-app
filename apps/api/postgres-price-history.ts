import { readShoppingMember, type ShoppingTransaction } from './postgres-shopping.ts';
import type { ExecutePriceHistory, PriceObservation, PriceObservationDetail } from './price-history.ts';

const observationFields = `
  observation.resource_id::text AS id, observation.id AS "sourceId",
  observation.record_version AS version,
  to_char(observation.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "capturedAt",
  observation.product_id AS "productId", observation.source_product_id AS "sourceProductId",
  observation.source_product_name AS "productName",
  observation.shop_id AS "shopId", observation.source_shop_id AS "sourceShopId",
  observation.shop_display_name AS "shopDisplayName",
  observation.price_amount::text AS "priceAmount", observation.currency,
  observation.review, observation.unit_price AS "unitPrice",
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object('role', photo.role, 'width', photo.width, 'height', photo.height)
      ORDER BY photo.role DESC)
    FROM cheapo.price_photo AS photo
    WHERE (photo.household_id, photo.shopper_id, photo.observation_id) =
      (observation.household_id, observation.shopper_id, observation.id)
  ), '[]'::jsonb) AS photos
`;

const visibleObservations = `
  FROM cheapo.price_observation AS observation
  LEFT JOIN cheapo.product AS product ON product.id = observation.product_id
  WHERE observation.household_id = $1::uuid
    AND observation.status = 'complete' AND observation.source_test_shop IS NOT TRUE
`;

export function postgresPriceHistory(transaction: ShoppingTransaction): ExecutePriceHistory {
  return (digest, read) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };

    if (read.kind === 'detail') {
      const { rows: [detail] } = await query<Omit<PriceObservationDetail, 'selectedPhotoRole'>>(`
        SELECT ${observationFields}, observation.crop_box AS "cropBox"
        ${visibleObservations}
        AND observation.resource_id = $2::uuid
      `, [member.household_id, read.id]);
      if (!detail) return { status: 'not_found' };
      const selectedPhotoRole = detail.photos.find(photo => photo.role === 'crop')?.role ?? detail.photos[0]?.role ?? null;
      return { status: 'detail', observation: { ...detail, selectedPhotoRole } };
    }

    const { limit, cursor, filters } = read;
    const { rows } = await query<PriceObservation>(`
      SELECT ${observationFields}
      ${visibleObservations}
      AND ($2::timestamptz IS NULL OR (observation.captured_at, observation.resource_id) < ($2::timestamptz, $3::uuid))
      AND ($5::text IS NULL OR observation.product_id = $5)
      AND (
        ($6::text IS NULL AND $7::text IS NULL) OR product.comparable_group_id = $6
        OR (($6::text IS NULL OR product.comparable_group_id IS NULL)
          AND lower(btrim(coalesce(nullif(btrim(observation.review->>'productType'), ''), product.product_type))) = lower($7))
      )
      AND ($8::text IS NULL OR observation.currency = $8)
      ORDER BY observation.captured_at DESC, observation.resource_id DESC
      LIMIT $4::int
    `, [member.household_id, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1,
      filters.productId, filters.comparableGroupId, filters.productType, filters.currency]);
    return { status: 'ok', observations: rows };
  });
}
