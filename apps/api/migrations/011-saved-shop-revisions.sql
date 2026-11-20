BEGIN;

ALTER TABLE cheapo.shop
  ADD COLUMN record_version integer NOT NULL DEFAULT 1 CHECK (record_version > 0);
ALTER TABLE cheapo.household_saved_shop
  ADD COLUMN link_revision uuid NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE cheapo.saved_shop_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id text NOT NULL REFERENCES cheapo.shop,
  household_id uuid NOT NULL,
  actor_shopper_id uuid NOT NULL,
  operation_id text,
  operation_request jsonb NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (household_id, actor_shopper_id, operation_id),
  FOREIGN KEY (household_id, actor_shopper_id) REFERENCES cheapo.household_membership
);

COMMIT;
