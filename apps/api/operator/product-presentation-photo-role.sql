BEGIN;

GRANT SELECT (
  actor_household_id, actor_shopper_id, operation_id, product_id, asset_id,
  expected_version, published_version, sha256, byte_count, width, height
), INSERT (
  actor_household_id, actor_shopper_id, operation_id, product_id, expected_version,
  sha256, byte_count, width, height
), UPDATE (published_version, published_at) ON cheapo.product_presentation_photo TO cheapo_api_runtime;

COMMIT;
