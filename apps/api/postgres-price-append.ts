import { readShoppingMember, type ShoppingTransaction } from './postgres-shopping.ts';
import type { ExecutePriceAppend, PriceIdentity } from './price-append.ts';

export function postgresPriceAppend(transaction: ShoppingTransaction): ExecutePriceAppend {
  return (digest, observation) => transaction(async query => {
    const member = await readShoppingMember(query, digest);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };

    const { sourceId, capturedAt, productId, shopId, shopDisplayName, review, unitPrice } = observation;
    const params = [
      member.household_id, member.shopper_id, sourceId, capturedAt, productId ?? null,
      shopId, shopDisplayName, review.productName, review.price, review.currency,
      { ...review, shop: shopDisplayName }, unitPrice ?? null,
    ];
    const { rows: [created] } = await query<PriceIdentity>(`
      INSERT INTO cheapo.price_observation (
        household_id, shopper_id, id, captured_at, product_id, source_product_id, shop_id, source_shop_id,
        shop_display_name, source_product_name, price_amount, currency, review, unit_price, status, source_test_shop
      )
      SELECT saved.household_id, $2::uuid, $3, $4::timestamptz, $5, $5, saved.shop_id, saved.shop_id,
        $7, $8, $9::numeric, $10, $11::jsonb, $12::jsonb, 'complete', saved.source_test_shop
      FROM cheapo.household_saved_shop AS saved
      WHERE saved.household_id = $1::uuid AND saved.shop_id = $6
        AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM cheapo.product WHERE id = $5))
      FOR SHARE OF saved
      ON CONFLICT (household_id, shopper_id, id) DO NOTHING
      RETURNING resource_id::text AS id, id AS "sourceId", record_version AS version
    `, params);
    if (created) return { status: 'created', identity: created };

    const { rows: [existing] } = await query<PriceIdentity & { matches: boolean }>(`
      SELECT resource_id::text AS id, id AS "sourceId", record_version AS version,
        status = 'complete' AND
        (captured_at, product_id, source_product_id, shop_id, source_shop_id, shop_display_name,
          source_product_name, price_amount, currency, review, unit_price)
          IS NOT DISTINCT FROM ($4::timestamptz, $5::text, $5::text, $6::text, $6::text, $7::text,
            $8::text, $9::numeric, $10::text, $11::jsonb, $12::jsonb) AS matches
      FROM cheapo.price_observation
      WHERE household_id = $1::uuid AND shopper_id = $2::uuid AND id = $3
      FOR SHARE
    `, params);
    if (!existing) return { status: 'invalid_reference' };
    const { matches, ...identity } = existing;
    return matches ? { status: 'replayed', identity } : { status: 'source_conflict' };
  });
}
