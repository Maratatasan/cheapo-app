BEGIN;

CREATE TABLE cheapo.price_photo_upload (
  household_id uuid NOT NULL,
  shopper_id uuid NOT NULL,
  observation_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('original', 'crop')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer NOT NULL CHECK (byte_count BETWEEN 1 AND 33554432),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 16384),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 16384),
  PRIMARY KEY (household_id, shopper_id, observation_id, role),
  FOREIGN KEY (household_id, shopper_id, observation_id) REFERENCES cheapo.price_observation
);

COMMIT;
