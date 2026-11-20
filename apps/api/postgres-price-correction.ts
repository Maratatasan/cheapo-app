import type { ExecutePriceCorrection, PriceCorrection } from './price-correction.ts';
import type { PriceObservationDetail } from './price-history.ts';
import { readObservationDetail } from './postgres-price-history.ts';
import { readShoppingMember, type ShoppingQuery, type ShoppingTransaction } from './postgres-shopping.ts';

async function saveReviewedFields(
  query: ShoppingQuery, home: string, before: PriceObservationDetail, action: Extract<PriceCorrection, { action: 'correct' }>,
) {
  const productId = action.productId === undefined ? before.productId : action.productId;
  const shopId = action.shop?.id ?? before.shopId;
  const displayName = action.shop?.displayName ?? before.shopDisplayName;
  const changedShopId = shopId === before.shopId ? null : shopId;
  const { rows: [reference] } = await query<{ allowed: boolean }>(`
    SELECT ($1::text IS NULL OR EXISTS (SELECT 1 FROM cheapo.product WHERE id = $1))
      AND ($2::text IS NULL OR EXISTS (
        SELECT 1 FROM cheapo.household_saved_shop WHERE household_id = $3::uuid AND shop_id = $2
      )) AS allowed
  `, [productId, changedShopId, home]);
  if (!reference.allowed) return false;

  const selection = action.photoSelection;
  await query(`
    UPDATE cheapo.price_observation SET
      product_id = $3, shop_id = $4, shop_display_name = $5, price_amount = $6::numeric,
      currency = $7, review = $8::jsonb, unit_price = $9::jsonb, record_version = record_version + 1,
      photo_selection_overridden = photo_selection_overridden OR $10::boolean,
      selected_crop_box = CASE WHEN $10::boolean THEN $11::jsonb ELSE selected_crop_box END
    WHERE household_id = $1::uuid AND resource_id = $2::uuid
  `, [home, before.id, productId, shopId, displayName, action.review.price, action.review.currency,
    { ...action.review, shop: displayName ?? undefined }, action.unitPrice ?? null, Boolean(selection),
    selection?.role === 'crop' ? selection.cropBox : null]);
  return true;
}

export function postgresPriceCorrection(transaction: ShoppingTransaction): ExecutePriceCorrection {
  return (digest, id, action) => transaction(async query => {
    const member = await readShoppingMember(query, digest, true);
    if (!member) return { status: 'unauthenticated' };
    if (!member.active) return { status: 'forbidden' };
    const home = member.household_id;

    // Serialize correction operations within the authenticated household. Look up a replay before checking the current version.
    const { rows: [replay] } = await query<{
      matches: boolean; observation: PriceObservationDetail; ownedByCurrentShopper: boolean;
    }>(`
      SELECT revision.resource_id = $4::uuid AND revision.operation_request = $5::jsonb AS matches,
        revision.after_state AS observation, observation.shopper_id = $2::uuid AS "ownedByCurrentShopper"
      FROM cheapo.price_observation_revision AS revision
      JOIN cheapo.price_observation AS observation
        ON observation.resource_id = revision.resource_id AND observation.household_id = revision.household_id
      WHERE revision.household_id = $1::uuid AND revision.actor_shopper_id = $2::uuid AND revision.operation_id = $3
    `, [home, member.shopper_id, action.operationId, id, action]);
    if (replay) return replay.matches
      ? { status: 'ok', observation: { ...replay.observation, ownedByCurrentShopper: replay.ownedByCurrentShopper } }
      : { status: 'operation_conflict' };

    const before = await readObservationDetail(query, member, id, { lock: true });
    if (!before) return { status: 'not_found' };
    if (before.version !== action.expectedVersion) return { status: 'version_conflict', current: before };

    if (action.action === 'correct') {
      if (!await saveReviewedFields(query, home, before, action)) return { status: 'invalid_reference' };
    } else {
      const reason = action.action === 'record_in_error' ? action.reason : null;
      if (Boolean(reason) === Boolean(before.recordedInErrorReason)) return { status: 'invalid_observation_state' };
      await query(`
        UPDATE cheapo.price_observation SET recorded_in_error_reason = $3, record_version = record_version + 1
        WHERE household_id = $1::uuid AND resource_id = $2::uuid
      `, [home, id, reason]);
    }

    const after = await readObservationDetail(query, member, id);
    if (!after) throw new Error('Could not read the committed observation revision.');
    await query(`
      INSERT INTO cheapo.price_observation_revision
        (resource_id, version, household_id, actor_shopper_id, operation_id, operation_request, before_state, after_state)
      VALUES ($1::uuid, $2::int, $3::uuid, $4::uuid, $5, $6::jsonb, $7::jsonb, $8::jsonb)
    `, [id, after.version, home, member.shopper_id, action.operationId, action, before, after]);
    return { status: 'ok', observation: after };
  });
}
