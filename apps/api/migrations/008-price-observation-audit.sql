BEGIN;

ALTER TABLE cheapo.price_observation
  ADD COLUMN recorded_in_error_reason text
    CHECK (char_length(btrim(recorded_in_error_reason)) BETWEEN 1 AND 300);

CREATE TABLE cheapo.price_observation_revision (
  resource_id uuid NOT NULL REFERENCES cheapo.price_observation (resource_id),
  version integer NOT NULL CHECK (version > 1),
  household_id uuid NOT NULL,
  actor_shopper_id uuid NOT NULL,
  operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 1 AND 128),
  operation_request jsonb NOT NULL CHECK (jsonb_typeof(operation_request) = 'object'),
  before_state jsonb NOT NULL CHECK (jsonb_typeof(before_state) = 'object'),
  after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state) = 'object'),
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (resource_id, version),
  UNIQUE (household_id, actor_shopper_id, operation_id),
  FOREIGN KEY (household_id, actor_shopper_id) REFERENCES cheapo.household_membership
);

COMMIT;
