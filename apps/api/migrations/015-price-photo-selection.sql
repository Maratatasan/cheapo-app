BEGIN;

ALTER TABLE cheapo.price_observation
  ADD COLUMN photo_selection_overridden boolean NOT NULL DEFAULT false,
  ADD COLUMN selected_crop_box jsonb CHECK (jsonb_typeof(selected_crop_box) = 'object');

COMMIT;
