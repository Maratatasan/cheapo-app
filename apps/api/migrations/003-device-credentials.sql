BEGIN;

ALTER TABLE cheapo.shopper_credential
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT shopper_credential_id_unique UNIQUE (id);

COMMIT;
