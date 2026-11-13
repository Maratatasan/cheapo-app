BEGIN;
CREATE SCHEMA poc;

CREATE TABLE poc.household (
  id uuid PRIMARY KEY
);

CREATE TABLE poc.shop (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE poc.saved_shop (
  household_id uuid NOT NULL REFERENCES poc.household,
  shop_id uuid NOT NULL REFERENCES poc.shop,
  nickname text,
  PRIMARY KEY (household_id, shop_id)
);

CREATE TABLE poc.product (
  id uuid PRIMARY KEY,
  barcode text UNIQUE,
  brand text NOT NULL,
  variety text NOT NULL,
  comparison_group text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0 AND quantity < 'Infinity'::numeric),
  unit text NOT NULL,
  comparison_unit text GENERATED ALWAYS AS (
    CASE unit WHEN 'g' THEN 'kg' WHEN 'kg' THEN 'kg'
              WHEN 'ml' THEN 'l' WHEN 'l' THEN 'l' WHEN 'each' THEN 'each' END
  ) STORED
);

CREATE TABLE poc.observation (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES poc.product,
  shop_id uuid NOT NULL REFERENCES poc.shop,
  price_minor integer NOT NULL CHECK (price_minor >= 0),
  currency text NOT NULL CHECK (currency = 'GBP'),
  observed_at timestamptz NOT NULL CHECK (isfinite(observed_at)),
  photo_ref text,
  original_price_minor integer NOT NULL CHECK (original_price_minor >= 0),
  original_photo_ref text
);

CREATE INDEX product_comparison_idx ON poc.product (comparison_group, comparison_unit);
CREATE INDEX observation_latest_idx ON poc.observation (product_id, shop_id, observed_at DESC, id DESC);

CREATE VIEW poc.saved_shop_payload AS
SELECT household_id AS "householdId", shop_id AS "shopId", nickname
FROM poc.saved_shop;

CREATE VIEW poc.product_payload AS
SELECT id, barcode, brand, variety, comparison_group AS "comparisonGroup", quantity, unit
FROM poc.product;

CREATE VIEW poc.observation_payload AS
SELECT id, product_id AS "productId", shop_id AS "shopId", price_minor AS "priceMinor",
       currency, observed_at AS "observedAt", photo_ref AS "photoRef"
FROM poc.observation;

CREATE FUNCTION poc.listSavedShops(input jsonb)
RETURNS SETOF poc.saved_shop_payload LANGUAGE sql STABLE AS $$
  SELECT * FROM poc.saved_shop_payload
  WHERE "householdId" = (input->>'householdId')::uuid
  ORDER BY "shopId";
$$;

CREATE FUNCTION poc.renameSavedShop(input jsonb)
RETURNS SETOF poc.saved_shop_payload LANGUAGE sql AS $$
  UPDATE poc.saved_shop
  SET nickname = input->>'nickname'
  WHERE household_id = (input->>'householdId')::uuid AND shop_id = (input->>'shopId')::uuid
  RETURNING household_id, shop_id, nickname;
$$;

CREATE FUNCTION poc.unlinkSavedShop(input jsonb)
RETURNS void LANGUAGE sql AS $$
  DELETE FROM poc.saved_shop
  WHERE household_id = (input->>'householdId')::uuid AND shop_id = (input->>'shopId')::uuid;
$$;

CREATE FUNCTION poc.lookupBarcode(input jsonb)
RETURNS SETOF poc.product_payload LANGUAGE sql STABLE AS $$
  SELECT * FROM poc.product_payload WHERE barcode = input->>'barcode';
$$;

CREATE FUNCTION poc.createProduct(input jsonb)
RETURNS SETOF poc.product_payload LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  requested poc.product_payload := jsonb_populate_record(NULL::poc.product_payload, input);
  existing poc.product_payload;
BEGIN
  INSERT INTO poc.product (id, barcode, brand, variety, comparison_group, quantity, unit)
  VALUES (requested.id, requested.barcode, requested.brand, requested.variety,
          requested."comparisonGroup", requested.quantity, requested.unit)
  ON CONFLICT DO NOTHING;

  -- A separate statement sees the committed winner of a concurrent insert.
  SELECT * INTO existing FROM poc.product_payload WHERE id = requested.id;
  IF NOT FOUND OR existing IS DISTINCT FROM requested THEN
    RAISE unique_violation USING MESSAGE = 'Product UUID or barcode is already in use';
  END IF;
  RETURN NEXT existing;
END;
$$;

CREATE FUNCTION poc.createObservation(input jsonb)
RETURNS SETOF poc.observation_payload LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  requested poc.observation_payload := jsonb_populate_record(NULL::poc.observation_payload, input);
  existing poc.observation%ROWTYPE;
BEGIN
  INSERT INTO poc.observation
    (id, product_id, shop_id, price_minor, currency, observed_at, photo_ref,
     original_price_minor, original_photo_ref)
  VALUES (requested.id, requested."productId", requested."shopId", requested."priceMinor",
          requested.currency, requested."observedAt", requested."photoRef",
          requested."priceMinor", requested."photoRef")
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO existing FROM poc.observation WHERE id = requested.id;
  IF ROW(existing.product_id, existing.shop_id, existing.original_price_minor,
         existing.currency, existing.observed_at, existing.original_photo_ref) IS DISTINCT FROM
     ROW(requested."productId", requested."shopId", requested."priceMinor",
         requested.currency, requested."observedAt", requested."photoRef") THEN
    RAISE unique_violation USING MESSAGE = 'Observation UUID is already in use';
  END IF;
  RETURN QUERY SELECT * FROM poc.observation_payload WHERE id = requested.id;
END;
$$;

CREATE FUNCTION poc.correctObservation(input jsonb)
RETURNS SETOF poc.observation_payload LANGUAGE sql AS $$
  UPDATE poc.observation
  SET price_minor = CASE WHEN (input->'patch') ? 'priceMinor'
                    THEN (input->'patch'->>'priceMinor')::integer ELSE price_minor END,
      photo_ref = CASE WHEN (input->'patch') ? 'photoRef'
                  THEN input->'patch'->>'photoRef' ELSE photo_ref END
  WHERE id = (input->>'observationId')::uuid
  RETURNING id, product_id, shop_id, price_minor, currency, observed_at, photo_ref;
$$;

CREATE FUNCTION poc.latestPrice(input jsonb)
RETURNS SETOF poc.observation_payload LANGUAGE sql STABLE AS $$
  SELECT * FROM poc.observation_payload
  WHERE "productId" = (input->>'productId')::uuid AND "shopId" = (input->>'shopId')::uuid
  ORDER BY "observedAt" DESC, id DESC
  LIMIT 1;
$$;

CREATE FUNCTION poc.storedObservations(input jsonb)
RETURNS SETOF poc.observation_payload LANGUAGE sql STABLE AS $$
  SELECT * FROM poc.observation_payload
  WHERE "productId" = (input->>'productId')::uuid AND "shopId" = (input->>'shopId')::uuid
  ORDER BY "observedAt", id;
$$;

CREATE FUNCTION poc.compare(input jsonb)
RETURNS TABLE ("productId" uuid, "shopId" uuid, "observationId" uuid,
               unit text, "normalizedPriceMinor" numeric) LANGUAGE sql STABLE AS $$
  SELECT candidate.id, saved.shop_id, latest.id, candidate.comparison_unit,
         (latest.price_minor * 1.000000000000000000000000000000)
         / (candidate.quantity * CASE WHEN candidate.unit IN ('g', 'ml') THEN 0.001 ELSE 1 END)
         AS normalized_price
  FROM poc.product AS reference
  JOIN poc.product AS candidate
    ON candidate.comparison_group = reference.comparison_group
   AND candidate.comparison_unit = reference.comparison_unit
  JOIN poc.saved_shop AS saved ON saved.household_id = (input->>'householdId')::uuid
  JOIN LATERAL (
    SELECT id, price_minor FROM poc.observation
    WHERE product_id = candidate.id AND shop_id = saved.shop_id
    ORDER BY observed_at DESC, id DESC LIMIT 1
  ) AS latest ON true
  WHERE reference.id = (input->>'referenceProductId')::uuid
    AND (NOT COALESCE((input->>'sameBrand')::boolean, false) OR candidate.brand = reference.brand)
    AND (NOT COALESCE((input->>'sameVariety')::boolean, false) OR candidate.variety = reference.variety)
  ORDER BY normalized_price, saved.shop_id, candidate.id;
$$;

COMMIT;
