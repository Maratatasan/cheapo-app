BEGIN;

CREATE SCHEMA cheapo;

CREATE TABLE cheapo.shopper (
  id uuid PRIMARY KEY
);

CREATE TABLE cheapo.household (
  id uuid PRIMARY KEY
);

CREATE TABLE cheapo.household_membership (
  household_id uuid NOT NULL REFERENCES cheapo.household ON DELETE CASCADE,
  shopper_id uuid NOT NULL REFERENCES cheapo.shopper ON DELETE CASCADE,
  revoked_at timestamptz,
  PRIMARY KEY (household_id, shopper_id)
);

CREATE TABLE cheapo.shopper_credential (
  token_digest text PRIMARY KEY CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  household_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at) AND expires_at > issued_at),
  revoked_at timestamptz,
  FOREIGN KEY (household_id, shopper_id)
    REFERENCES cheapo.household_membership ON DELETE CASCADE
);

CREATE TABLE cheapo.comparison_preference (
  shopper_id uuid NOT NULL REFERENCES cheapo.shopper ON DELETE CASCADE,
  product_group_id text NOT NULL CHECK (char_length(product_group_id) BETWEEN 1 AND 128),
  basis text NOT NULL CHECK (basis IN ('kg', '100g', 'litre', '100mL', 'item', 'wash')),
  PRIMARY KEY (shopper_id, product_group_id)
);

COMMIT;
