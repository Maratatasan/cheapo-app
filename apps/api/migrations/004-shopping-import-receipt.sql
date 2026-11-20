BEGIN;

ALTER TABLE cheapo.household_saved_shop ADD COLUMN source_test_shop boolean;
ALTER TABLE cheapo.price_observation ADD COLUMN source_test_shop boolean;
ALTER TABLE cheapo.price_observation ADD COLUMN source_product_name text;

-- The validated source metadata also retains original catalog versions that
-- were subsequent candidates for a correction. Photo bytes stay out of PostgreSQL.
CREATE TABLE cheapo.shopping_import_receipt (
  household_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  version smallint NOT NULL CHECK (version IN (1, 2, 3)),
  exported_at timestamptz NOT NULL CHECK (isfinite(exported_at)),
  source jsonb CHECK (jsonb_typeof(source) = 'object'),
  source_catalog jsonb CHECK (jsonb_typeof(source_catalog) = 'object'),
  PRIMARY KEY (household_id, shopper_id, sha256),
  FOREIGN KEY (household_id, shopper_id) REFERENCES cheapo.household_membership
);

COMMIT;
