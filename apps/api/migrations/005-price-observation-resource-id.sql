BEGIN;

ALTER TABLE cheapo.price_observation
  ADD COLUMN resource_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT price_observation_resource_id_unique UNIQUE (resource_id),
  ADD COLUMN record_version integer NOT NULL DEFAULT 1 CHECK (record_version > 0);

CREATE INDEX price_observation_household_history
  ON cheapo.price_observation (household_id, captured_at DESC, resource_id DESC)
  WHERE status = 'complete' AND source_test_shop IS NOT TRUE;

COMMIT;
