import { comparisonProductTypeAliases } from '@cheapo/domain/comparison-product-types';

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
type DetailRow = PriceRow & { cropBox: PriceObservationDetail['cropBox']; photoSelectionOverridden: boolean };

export async function readObservationDetail(query: ShoppingQuery, member: ShoppingMember, id: string, lock = false) {
  const { rows: [row] } = await query<DetailRow>(`
    SELECT ${observationFields},
      CASE WHEN observation.photo_selection_overridden THEN observation.selected_crop_box ELSE observation.crop_box END AS "cropBox",
      observation.photo_selection_overridden AS "photoSelectionOverridden",
      observation.shopper_id = $3::uuid AS "ownedByCurrentShopper"
    ${visibleObservations}
    AND observation.resource_id = $2::uuid
    ${lock ? 'FOR UPDATE OF observation' : ''}
  `, [member.household_id, id, member.shopper_id]);
  if (!row) return undefined;
  const { errorReason, photoSelectionOverridden, ...detail } = row;
  const original = detail.photos.find(photo => photo.role === 'original');
  const storedCrop = detail.photos.find(photo => photo.role === 'crop');
  const selectedPhotoRole = photoSelectionOverridden
    ? original ? detail.cropBox ? 'crop' : 'original' : null
    : storedCrop?.role ?? original?.role ?? null;
  return { ...detail, selectedPhotoRole,
    ...(photoSelectionOverridden ? { cropSource: 'original' as const } : {}),
    ...(errorReason ? { recordedInErrorReason: errorReason } : {}) };
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

    const { limit, cursor, filters, sourceId, includeRecordedInError } = read;
    const types = filters.productType ? JSON.stringify(comparisonProductTypeAliases(filters.productType)) : null;
    const { rows } = await query<PriceRow>(`
      SELECT ${observationFields}, observation.shopper_id = $10::uuid AS "ownedByCurrentShopper"
      ${visibleObservations}
      AND ($2::timestamptz IS NULL OR (observation.captured_at, observation.resource_id) < ($2::timestamptz, $3::uuid))
      AND ($5::text IS NULL OR observation.product_id = $5)
      AND (
        ($6::text IS NULL AND $7::jsonb IS NULL) OR product.comparable_group_id = $6
        OR (($6::text IS NULL OR product.comparable_group_id IS NULL)
          AND lower(btrim(coalesce(nullif(btrim(observation.review->>'productType'), ''), product.product_type)))
            IN (SELECT lower(type) FROM jsonb_array_elements_text($7::jsonb) AS types(type)))
      )
      AND ($8::text IS NULL OR observation.currency = $8)
      AND ($9::boolean OR observation.recorded_in_error_reason IS NULL)
      AND ($11::text IS NULL OR (observation.shopper_id = $10::uuid AND observation.id = $11::text))
      ORDER BY observation.captured_at DESC, observation.resource_id DESC
      LIMIT $4::int
    `, [member.household_id, cursor?.[0] ?? null, cursor?.[1] ?? null, limit + 1,
      filters.productId, filters.comparableGroupId, types, filters.currency, includeRecordedInError, member.shopper_id, sourceId ?? null]);
    return {
      status: 'ok',
      observations: rows.map(({ errorReason, ...observation }) => errorReason
        ? { ...observation, recordedInErrorReason: errorReason }
        : observation),
    };
  });
}
