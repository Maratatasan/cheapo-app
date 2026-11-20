BEGIN;

-- Run after schema migrations as the PostgreSQL project operator with role creation rights.
-- A separate login can be granted the runtime role. This script does not create its password.
CREATE ROLE cheapo_api_runtime NOLOGIN;
CREATE ROLE cheapo_scope_guard NOLOGIN;

GRANT USAGE ON SCHEMA cheapo TO cheapo_api_runtime, cheapo_scope_guard;
GRANT SELECT (token_digest, household_id, shopper_id, revoked_at, expires_at),
  UPDATE (id) ON cheapo.shopper_credential TO cheapo_scope_guard;
GRANT SELECT (household_id, shopper_id, revoked_at),
  UPDATE (revoked_at) ON cheapo.household_membership TO cheapo_scope_guard;
GRANT SELECT (id), UPDATE (id) ON cheapo.household TO cheapo_scope_guard;

GRANT EXECUTE ON FUNCTION cheapo.resolve_shopping_member(text, boolean) TO cheapo_api_runtime;

-- The definer has just enough authority for row locks. Runtime is not a member.
GRANT CREATE ON SCHEMA cheapo TO cheapo_scope_guard;
GRANT cheapo_scope_guard TO CURRENT_USER;
ALTER FUNCTION cheapo.resolve_shopping_member(text, boolean) OWNER TO cheapo_scope_guard;
REVOKE cheapo_scope_guard FROM CURRENT_USER;
REVOKE CREATE ON SCHEMA cheapo FROM cheapo_scope_guard;

GRANT SELECT ON cheapo.shop, cheapo.household_saved_shop, cheapo.shopper_current_shop,
  cheapo.comparison_preference, cheapo.price_observation, cheapo.price_photo TO cheapo_api_runtime;

GRANT INSERT (
  household_id, shopper_id, id, captured_at, product_id, source_product_id, shop_id, source_shop_id,
  shop_display_name, source_product_name, price_amount, currency, review, unit_price, status, source_test_shop
) ON cheapo.price_observation TO cheapo_api_runtime;
GRANT SELECT (household_id, shopper_id, observation_id, resource_id, accepted_version, payload),
  INSERT (household_id, shopper_id, observation_id, resource_id, accepted_version, payload)
  ON cheapo.price_append_receipt TO cheapo_api_runtime;

GRANT INSERT (id, name, address, location), UPDATE (name, address) ON cheapo.shop TO cheapo_api_runtime;
GRANT INSERT (household_id, shop_id, nickname), UPDATE (nickname), DELETE
  ON cheapo.household_saved_shop TO cheapo_api_runtime;
GRANT INSERT (household_id, shopper_id, shop_id), UPDATE (shop_id), DELETE
  ON cheapo.shopper_current_shop TO cheapo_api_runtime;
GRANT INSERT (shopper_id, product_group_id, basis), UPDATE (basis), DELETE
  ON cheapo.comparison_preference TO cheapo_api_runtime;
GRANT SELECT (id, gtin, name, product_type, brand, variety, pack, comparable_group_id),
  INSERT (id, gtin, name, product_type, brand, variety, pack, comparable_group_id)
  ON cheapo.product TO cheapo_api_runtime;

GRANT SELECT ON cheapo.price_photo_upload TO cheapo_api_runtime;
GRANT INSERT (household_id, shopper_id, observation_id, role, sha256, byte_count, width, height)
  ON cheapo.price_photo_upload TO cheapo_api_runtime;

COMMIT;
