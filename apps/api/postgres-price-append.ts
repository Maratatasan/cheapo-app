import type { PriceAppend } from '@cheapo/domain/price-append';

import { importedEvidenceKey } from './evidence-key.ts';
import { readObservationDetail } from './postgres-price-history.ts';
import { readShoppingMember, type ShoppingMember, type ShoppingQuery, type ShoppingTransaction } from './postgres-shopping.ts';
import type { ExecutePriceAppend, PriceIdentity } from './price-append.ts';

const receiptPayload = `
  jsonb_build_object(
    'capturedAt', $4::timestamptz AT TIME ZONE 'UTC', 'productId', $5::text, 'sourceProductId', $5::text,
    'shopId', $6::text, 'sourceShopId', $6::text, 'shopDisplayName', $7::text,
    'productName', $8::text, 'priceAmount', $9::numeric, 'currency', $10::text,
    'review', $11::jsonb, 'unitPrice', $12::jsonb)
  || CASE WHEN $13::jsonb IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('cropBox', $13::jsonb) END
`;

async function appendReceipt(query: ShoppingQuery, params: unknown[]) {
  const { rows: [receipt] } = await query<PriceIdentity & { matches: boolean; derived: boolean }>(`
    SELECT resource_id::text AS id, observation_id AS "sourceId", accepted_version AS version,
      (payload - 'deriveCropFromOriginal') = ${receiptPayload} AS matches,
      coalesce(payload->'deriveCropFromOriginal' = 'true'::jsonb, false) AS derived
    FROM cheapo.price_append_receipt
    WHERE household_id = $1::uuid AND shopper_id = $2::uuid AND observation_id = $3
  `, params);
  if (!receipt) return undefined;
  const { matches, derived, ...identity } = receipt;
  return matches
    ? { status: 'replayed' as const, identity: { ...identity, ...(derived ? { deriveCropFromOriginal: true as const } : {}) } }
    : { status: 'source_conflict' as const };
}

async function finishImportedDraft(query: ShoppingQuery, member: ShoppingMember, observation: PriceAppend, params: unknown[]) {
  const { productId, shopId, shopDisplayName, review, unitPrice, cropBox } = observation;
  const { rows: [draft] } = await query<{
    id: string; promotable: boolean; prior: Record<string, unknown>;
    originalKey: string | null; originalSha: string | null;
  }>(`
    SELECT draft.resource_id::text AS id, to_jsonb(draft) AS prior,
      (draft.status = 'draft' AND draft.source_test_shop IS FALSE AND draft.captured_at = $4::timestamptz) AS promotable,
      original.storage_key AS "originalKey", original.sha256 AS "originalSha"
    FROM cheapo.price_observation AS draft
    LEFT JOIN cheapo.price_photo AS original
      ON (original.household_id, original.shopper_id, original.observation_id) = (draft.household_id, draft.shopper_id, draft.id)
      AND original.role = 'original'
    WHERE draft.household_id = $1::uuid AND draft.shopper_id = $2::uuid AND draft.id = $3
    FOR UPDATE OF draft
  `, params.slice(0, 4));
  if (!draft) return { status: 'invalid_reference' as const };
  // A concurrent completion may have finished while this transaction waited for the draft lock.
  if (!draft.promotable) return await appendReceipt(query, params) ?? { status: 'source_conflict' as const };

  const { rows: [eligible] } = await query<{ allowed: boolean }>(`
    SELECT true AS allowed
    FROM cheapo.household_saved_shop AS saved
    WHERE saved.household_id = $1::uuid AND saved.shop_id = $2 AND saved.source_test_shop IS NOT TRUE
      AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM cheapo.product WHERE id = $3))
    FOR SHARE OF saved
  `, [member.household_id, shopId, productId ?? null]);
  if (!eligible) return { status: 'invalid_reference' as const };
  const hasImportedOriginal = draft.originalSha !== null
    && draft.originalKey === importedEvidenceKey(member.household_id, member.shopper_id, draft.originalSha);
  const derivesSelection = hasImportedOriginal && cropBox !== undefined;
  const isFullPhoto = cropBox?.left === 0 && cropBox.top === 0 && cropBox.right === 1 && cropBox.bottom === 1;
  const selectedCropBox = derivesSelection && !isFullPhoto ? cropBox : null;

  await query(`
    UPDATE cheapo.price_observation AS draft SET
      status = 'complete', product_id = $3, shop_id = $4, shop_display_name = $5, price_amount = $6::numeric,
      currency = $7, review = $8::jsonb, unit_price = $9::jsonb, record_version = draft.record_version + 1,
      photo_selection_overridden = $10::boolean, selected_crop_box = $11::jsonb
    WHERE household_id = $1::uuid AND resource_id = $2::uuid
  `, [member.household_id, draft.id, productId ?? null, shopId, shopDisplayName, review.price, review.currency,
    { ...review, shop: shopDisplayName }, unitPrice ?? null, derivesSelection, selectedCropBox]);
  const after = await readObservationDetail(query, member, draft.id);
  if (!after) throw Error('The completed imported price could not be read.');
  await query(`
    WITH request AS (SELECT ${receiptPayload} AS payload),
    receipt AS (
      INSERT INTO cheapo.price_append_receipt (household_id, shopper_id, observation_id, resource_id, accepted_version, payload)
      SELECT $1::uuid, $2::uuid, $3, $14::uuid, $15::int,
        payload || CASE WHEN $16::boolean THEN '{"deriveCropFromOriginal":true}'::jsonb ELSE '{}'::jsonb END
      FROM request
      RETURNING payload
    )
    INSERT INTO cheapo.price_observation_revision
      (resource_id, version, household_id, actor_shopper_id, operation_id, operation_request, before_state, after_state)
    SELECT $14::uuid, $15::int, $1::uuid, $2::uuid, 'complete imported draft ' || $14::text,
      jsonb_build_object('action', 'complete_imported_draft', 'append', request.payload), $17::jsonb, $18::jsonb
    FROM request CROSS JOIN receipt
  `, [...params, draft.id, after.version, derivesSelection, draft.prior, after]);
  return { status: 'created' as const, identity: {
    id: draft.id, sourceId: after.sourceId, version: after.version, ...(derivesSelection ? { deriveCropFromOriginal: true as const } : {}),
  } };
}

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

    const receipt = await appendReceipt(query, params);
    if (receipt) return receipt;

    return finishImportedDraft(query, member, observation, params);
  });
}
