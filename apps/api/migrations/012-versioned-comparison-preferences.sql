BEGIN;

ALTER TABLE cheapo.comparison_preference
  ALTER COLUMN basis DROP NOT NULL,
  ADD COLUMN record_version integer NOT NULL DEFAULT 1 CHECK (record_version > 0);

CREATE TABLE cheapo.comparison_preference_revision (
  shopper_id uuid NOT NULL REFERENCES cheapo.shopper,
  product_group_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  household_id uuid NOT NULL,
  operation_id text,
  operation_request jsonb NOT NULL,
  before_basis text,
  after_basis text,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (shopper_id, product_group_id, version),
  UNIQUE (shopper_id, operation_id),
  FOREIGN KEY (household_id, shopper_id) REFERENCES cheapo.household_membership
);

COMMIT;
