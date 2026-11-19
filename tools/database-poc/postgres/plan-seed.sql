-- Extra data for observing planner choices. Rolled back after EXPLAIN.
INSERT INTO poc.product (id, brand, variety, comparison_group, quantity, unit)
SELECT md5('unrelated product ' || number)::uuid, 'Other brand', 'Other variety',
       'unrelated-' || number % 20, 1, 'each'
FROM generate_series(1, 5000) AS number;

INSERT INTO poc.observation
  (id, product_id, shop_id, price_minor, currency, observed_at, original_price_minor)
SELECT md5('unrelated observation ' || product.id::text || ' ' || visit)::uuid,
       product.id, '00000002-0000-4000-8000-000000000001', 100, 'GBP',
       '2026-09-30 12:00:00+00'::timestamptz - visit * interval '1 day', 100
FROM poc.product AS product
CROSS JOIN generate_series(1, 4) AS visit
WHERE product.comparison_group LIKE 'unrelated-%';

INSERT INTO poc.observation
  (id, product_id, shop_id, price_minor, currency, observed_at, original_price_minor)
SELECT md5('historical rice observation ' || visit)::uuid,
       '00000003-0000-4000-8000-000000000001', '00000002-0000-4000-8000-000000000001',
       180, 'GBP', '2026-09-30 12:00:00+00'::timestamptz - visit * interval '1 day', 180
FROM generate_series(1, 1000) AS visit;

ANALYZE poc.product;
ANALYZE poc.observation;
ANALYZE poc.saved_shop;
