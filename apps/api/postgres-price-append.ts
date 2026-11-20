import { readShoppingMember, type ShoppingTransaction } from './postgres-shopping.ts';
import type { ExecutePriceAppend, PriceIdentity } from './price-append.ts';

const receiptPayload = `
  jsonb_build_object(
    'capturedAt', $4::timestamptz AT TIME ZONE 'UTC', 'productId', $5::text, 'sourceProductId', $5::text,
    'shopId', $6::text, 'sourceShopId', $6::text, 'shopDisplayName', $7::text,
    'productName', $8::text, 'priceAmount', $9::numeric, 'currency', $10::text,
    'review', $11::jsonb, 'unitPrice', $12::jsonb)
  || CASE WHEN $13::jsonb IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('cropBox', $13::jsonb) END
`;

export function postgresPriceAppend(transaction: ShoppingTransaction): ExecutePriceAppend {
  return (digest, observation) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };

    const { sourceId, capturedAt, productId, shopId, shopDisplayName, review, unitPrice, cropBox } = observation;
    const params = [
      member.household_id, member.shopper_id, sourceId, capturedAt, productId ?? null,
      shopId, shopDisplayName, review.productName, review.price, review.currency,
      { ...review, shop: shopDisplayName }, unitPrice ?? null, cropBox ?? null,
    ];
    const { rows: [created] } = await query<PriceIdentity>(`
      WITH saved_observation AS (
        INSERT INTO cheapo.price_observation (
          household_id, shopper_id, id, captured_at, product_id, source_product_id, shop_id, source_shop_id,
          shop_display_name, source_product_name, price_amount, currency, review, unit_price, crop_box, status, source_test_shop
        )
        SELECT saved.household_id, $2::uuid, $3, $4::timestamptz, $5, $5, saved.shop_id, saved.shop_id,
          $7, $8, $9::numeric, $10, $11::jsonb, $12::jsonb, $13::jsonb, 'complete', saved.source_test_shop
        FROM cheapo.household_saved_shop AS saved
        WHERE saved.household_id = $1::uuid AND saved.shop_id = $6
          AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM cheapo.product WHERE id = $5))
        FOR SHARE OF saved
        ON CONFLICT (household_id, shopper_id, id) DO NOTHING
        RETURNING household_id, shopper_id, id, resource_id, record_version
      )
      INSERT INTO cheapo.price_append_receipt (household_id, shopper_id, observation_id, resource_id, accepted_version, payload)
      SELECT household_id, shopper_id, id, resource_id, record_version, ${receiptPayload}
      FROM saved_observation
      RETURNING resource_id::text AS id, observation_id AS "sourceId", accepted_version AS version
    `, params);
    if (created) return { status: 'created', identity: created };

    const { rows: [receipt] } = await query<PriceIdentity & { matches: boolean }>(`
      SELECT resource_id::text AS id, observation_id AS "sourceId", accepted_version AS version,
        payload = ${receiptPayload} AS matches
      FROM cheapo.price_append_receipt
      WHERE household_id = $1::uuid AND shopper_id = $2::uuid AND observation_id = $3
    `, params);
    if (receipt) {
      const { matches, ...identity } = receipt;
      return matches ? { status: 'replayed', identity } : { status: 'source_conflict' };
    }

    const { rows } = await query(`
      SELECT 1 AS present FROM cheapo.price_observation
      WHERE household_id = $1::uuid AND shopper_id = $2::uuid AND id = $3
    `, params.slice(0, 3));
    return { status: rows.length ? 'source_conflict' : 'invalid_reference' };
  });
}
