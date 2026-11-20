BEGIN;

CREATE TABLE cheapo.shop (
  id text PRIMARY KEY CHECK (id ~ '^[^[:space:]]+$'),
  name text,
  address text,
  location jsonb CHECK (jsonb_typeof(location) = 'object')
);

CREATE TABLE cheapo.household_saved_shop (
  household_id uuid NOT NULL REFERENCES cheapo.household,
  shop_id text NOT NULL REFERENCES cheapo.shop,
  nickname text,
  PRIMARY KEY (household_id, shop_id)
);

CREATE TABLE cheapo.shopper_current_shop (
  household_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  shop_id text NOT NULL,
  PRIMARY KEY (household_id, shopper_id),
  FOREIGN KEY (household_id, shopper_id) REFERENCES cheapo.household_membership,
  FOREIGN KEY (household_id, shop_id) REFERENCES cheapo.household_saved_shop
);

CREATE TABLE cheapo.product (
  id text PRIMARY KEY CHECK (id ~ '^[^[:space:]]+$'),
  gtin text UNIQUE CHECK (gtin ~ '^[0-9]{14}$' AND gtin <> '00000000000000'),
  name text NOT NULL,
  product_type text,
  brand text,
  variety text,
  pack jsonb CHECK (jsonb_typeof(pack) = 'object'),
  comparable_group_id text,
  source_photo_ids text[]
);

-- A source catalog revision is scoped to the collection that produced it.
CREATE TABLE cheapo.catalog_revision (
  household_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 999999999999),
  product_id text NOT NULL REFERENCES cheapo.product,
  previous_gtin text CHECK (previous_gtin ~ '^[0-9]{14}$' AND previous_gtin <> '00000000000000'),
  product_snapshot jsonb NOT NULL CHECK (jsonb_typeof(product_snapshot) = 'object'),
  PRIMARY KEY (household_id, shopper_id, revision),
  FOREIGN KEY (household_id, shopper_id) REFERENCES cheapo.household_membership
);

CREATE TABLE cheapo.price_observation (
  household_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  id text NOT NULL CHECK (id ~ '^[^[:space:]]+$'),
  product_id text REFERENCES cheapo.product,
  shop_id text REFERENCES cheapo.shop,
  source_product_id text,
  source_shop_id text,
  shop_display_name text,
  captured_at timestamptz NOT NULL CHECK (isfinite(captured_at)),
  status text NOT NULL CHECK (status IN ('draft', 'complete')),
  price_amount numeric CHECK (price_amount >= 0 AND price_amount < 'Infinity'::numeric),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  review jsonb CHECK (jsonb_typeof(review) = 'object'),
  unit_price jsonb CHECK (jsonb_typeof(unit_price) = 'object'),
  crop_box jsonb CHECK (jsonb_typeof(crop_box) = 'object'),
  PRIMARY KEY (household_id, shopper_id, id),
  FOREIGN KEY (household_id, shopper_id) REFERENCES cheapo.household_membership
);

-- These references are owned by the observation. A product's presentation photo is separate.
CREATE TABLE cheapo.price_photo (
  household_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  observation_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('original', 'crop')),
  storage_key text NOT NULL CHECK (storage_key <> ''),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count bigint NOT NULL CHECK (byte_count > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  PRIMARY KEY (household_id, shopper_id, observation_id, role),
  FOREIGN KEY (household_id, shopper_id, observation_id) REFERENCES cheapo.price_observation
);

COMMIT;
