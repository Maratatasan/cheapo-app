BEGIN;

CREATE TABLE cheapo.product_presentation_photo (
  actor_household_id uuid NOT NULL,
  actor_shopper_id uuid NOT NULL,
  operation_id text NOT NULL CHECK (operation_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  product_id text NOT NULL REFERENCES cheapo.product,
  asset_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expected_version integer NOT NULL CHECK (expected_version BETWEEN 0 AND 2147483646),
  published_version integer CHECK (published_version = expected_version + 1),
  prepared_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  published_at timestamptz CHECK ((published_at IS NULL) = (published_version IS NULL)),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer NOT NULL CHECK (byte_count BETWEEN 1 AND 8388608),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 4096),
  PRIMARY KEY (actor_household_id, actor_shopper_id, operation_id),
  FOREIGN KEY (actor_household_id, actor_shopper_id) REFERENCES cheapo.household_membership
);

-- The latest published version is the single catalog photo. Pending uploads
-- stay invisible, and older published rows remain replay receipts.
CREATE UNIQUE INDEX product_presentation_photo_version
  ON cheapo.product_presentation_photo (product_id, published_version)
  WHERE published_version IS NOT NULL;

COMMIT;
