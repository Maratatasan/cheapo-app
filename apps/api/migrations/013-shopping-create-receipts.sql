BEGIN;

CREATE TABLE cheapo.shopping_create_receipt (
  household_id uuid NOT NULL,
  actor_shopper_id uuid NOT NULL,
  operation_id text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('product', 'saved_shop')),
  resource_id text NOT NULL,
  operation_request jsonb NOT NULL,
  response jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (household_id, actor_shopper_id, operation_id),
  FOREIGN KEY (household_id, actor_shopper_id) REFERENCES cheapo.household_membership
);

COMMIT;
