BEGIN;

CREATE TABLE cheapo.price_observation_group (
  household_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  observation_id text NOT NULL,
  comparable_group_id text NOT NULL CHECK (
    char_length(comparable_group_id) BETWEEN 1 AND 128
    AND comparable_group_id !~ '[[:space:]]'
  ),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  PRIMARY KEY (household_id, shopper_id, observation_id),
  FOREIGN KEY (household_id, shopper_id, observation_id) REFERENCES cheapo.price_observation
);

COMMIT;
