BEGIN;

INSERT INTO cheapo.household VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');
INSERT INTO cheapo.shopper VALUES ('00000000-0000-4000-8000-000000000011');
INSERT INTO cheapo.household_membership (household_id, shopper_id) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000011');

INSERT INTO cheapo.shop (id, name) VALUES ('shop-demo', 'Example Market');
INSERT INTO cheapo.household_saved_shop VALUES
  ('00000000-0000-4000-8000-000000000001', 'shop-demo', 'Shop for Saturday');
INSERT INTO cheapo.shopper_current_shop VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'shop-demo');

INSERT INTO cheapo.product (id, gtin, name, pack) VALUES
  ('product-demo', '00012345600012', 'Example Oats', '{"quantity":500,"unit":"g"}');
INSERT INTO cheapo.catalog_revision VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011',
    1, 'product-demo', '00012345600029', '{"id":"product-demo","barcode":"00012345600012"}');

INSERT INTO cheapo.price_observation (
  household_id, shopper_id, id, product_id, shop_id, source_product_id, source_shop_id, shop_display_name,
  captured_at, status, price_amount, currency, review, unit_price
) VALUES (
  '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011',
  'price-demo', 'product-demo', 'shop-demo', 'product-demo', 'shop-demo', 'Shop at capture',
  '2026-01-02T10:30:00.123+01:00', 'complete', 3.19, 'GBP', '{"price":"3.19","packSize":" 500 g "}',
  '{"amount":0.638,"unit":"100g"}'
), (
  '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011',
  'price-demo-earlier', 'product-demo', 'shop-demo', 'product-demo', 'shop-demo', 'Old shop label',
  '2025-12-31T16:10:00Z', 'complete', 2.95, 'GBP', '{"price":"2.95"}', NULL
), (
  '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011',
  'legacy-price-demo', NULL, NULL, 'missing-exported-product', 'removed-shop', 'Former shop',
  '2026-01-03T10:30:00Z', 'draft', NULL, NULL, '{"price":"  ","currency":"$"}', NULL
);

INSERT INTO cheapo.price_photo (
  household_id, shopper_id, observation_id, role, storage_key, sha256, byte_count, width, height
) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011',
    'price-demo', 'original', 'test/original.jpg', repeat('a', 64), 2048, 800, 800),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011',
    'price-demo', 'crop', 'test/crop.jpg', repeat('b', 64), 512, 400, 400);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cheapo.price_observation AS observation
    JOIN cheapo.product ON product.id = observation.product_id
    JOIN cheapo.shop ON shop.id = observation.shop_id
    JOIN cheapo.household_saved_shop AS saved_shop USING (household_id, shop_id)
    WHERE observation.id = 'price-demo'
      AND observation.captured_at = '2026-01-02T09:30:00.123Z'::timestamptz
      AND observation.price_amount = 3.19 AND observation.currency = 'GBP'
      AND observation.review->>'packSize' = ' 500 g '
      AND observation.unit_price->>'unit' = '100g'
      AND observation.shop_display_name = 'Shop at capture'
      AND product.gtin = '00012345600012'
      AND shop.name = 'Example Market' AND saved_shop.nickname = 'Shop for Saturday'
  ) THEN
    RAISE EXCEPTION 'Expected linked price, product, branch and household nickname';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cheapo.price_observation
    WHERE id = 'legacy-price-demo' AND status = 'draft'
      AND product_id IS NULL AND shop_id IS NULL AND price_amount IS NULL AND currency IS NULL
      AND source_product_id = 'missing-exported-product' AND source_shop_id = 'removed-shop'
      AND review->>'price' = '  ' AND review->>'currency' = '$'
  ) THEN
    RAISE EXCEPTION 'Expected an incomplete, unlinked observation with original source values';
  END IF;

  IF (SELECT array_agg(price_amount ORDER BY captured_at) FROM cheapo.price_observation
      WHERE product_id = 'product-demo') IS DISTINCT FROM ARRAY[2.95, 3.19] THEN
    RAISE EXCEPTION 'Expected dated price history for one stable product';
  END IF;

  IF (SELECT array_agg(sha256 ORDER BY role) FROM cheapo.price_photo WHERE observation_id = 'price-demo')
      IS DISTINCT FROM ARRAY[repeat('b', 64), repeat('a', 64)] THEN
    RAISE EXCEPTION 'Expected distinct original and crop hashes';
  END IF;

  BEGIN
    INSERT INTO cheapo.shopper_current_shop VALUES
      ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000011', 'shop-demo');
    RAISE EXCEPTION 'Expected to reject a shop saved only by a different household';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE cheapo.price_photo SET household_id = '00000000-0000-4000-8000-000000000002'
    WHERE role = 'original';
    RAISE EXCEPTION 'Expected to reject a photo linked across households';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO cheapo.product (id, gtin, name) VALUES ('different-id', '00012345600012', 'Another product');
    RAISE EXCEPTION 'Expected to reject a duplicate GTIN';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
