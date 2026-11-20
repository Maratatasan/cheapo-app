import { readShoppingMember, type ShoppingTransaction } from './postgres-shopping.ts';
import type { ExecutePriceHistory, PriceObservation } from './price-history.ts';

export function postgresPriceHistory(transaction: ShoppingTransaction): ExecutePriceHistory {
  return (digest, { limit, cursor }) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };

    const { rows } = await query<PriceObservation>(`
      SELECT observation.resource_id::text AS id, observation.id AS "sourceId",
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
      FROM cheapo.price_observation AS observation
      WHERE observation.household_id = $1::uuid
        AND observation.status = 'complete' AND observation.source_test_shop IS NOT TRUE
        AND ($2::timestamptz IS NULL OR (observation.captured_at, observation.resource_id) < ($2::timestamptz, $3::uuid))
      ORDER BY observation.captured_at DESC, observation.resource_id DESC
      LIMIT $4::int
    `, [member.household_id, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1]);
    return { status: 'ok', observations: rows };
  });
}
