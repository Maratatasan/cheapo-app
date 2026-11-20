BEGIN;

ALTER TABLE cheapo.product ADD COLUMN record_version integer NOT NULL DEFAULT 1 CHECK (record_version > 0);

CREATE TABLE cheapo.product_revision (
  product_id text NOT NULL REFERENCES cheapo.product,
  version integer NOT NULL CHECK (version > 1),
  household_id uuid NOT NULL,
  actor_shopper_id uuid NOT NULL,
  operation_id text NOT NULL,
  operation_request jsonb NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (product_id, version),
  UNIQUE (household_id, actor_shopper_id, operation_id),
  FOREIGN KEY (household_id, actor_shopper_id) REFERENCES cheapo.household_membership
);

COMMIT;
