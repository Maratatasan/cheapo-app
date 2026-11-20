BEGIN;

CREATE TABLE cheapo.price_append_receipt (
  household_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  observation_id text NOT NULL,
  resource_id uuid NOT NULL REFERENCES cheapo.price_observation (resource_id),
  accepted_version integer NOT NULL CHECK (accepted_version > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (household_id, shopper_id, observation_id),
  FOREIGN KEY (household_id, shopper_id, observation_id) REFERENCES cheapo.price_observation
);

-- Match the append request comparison before corrections are available.
INSERT INTO cheapo.price_append_receipt (household_id, shopper_id, observation_id, resource_id, accepted_version, payload)
SELECT household_id, shopper_id, id, resource_id, record_version,
  jsonb_build_object(
    'capturedAt', captured_at AT TIME ZONE 'UTC', 'productId', product_id, 'sourceProductId', source_product_id,
    'shopId', shop_id, 'sourceShopId', source_shop_id, 'shopDisplayName', shop_display_name,
    'productName', source_product_name, 'priceAmount', price_amount, 'currency', currency,
    'review', review, 'unitPrice', unit_price)
FROM cheapo.price_observation
WHERE status = 'complete' AND record_version = 1 AND shop_id IS NOT NULL;

COMMIT;
