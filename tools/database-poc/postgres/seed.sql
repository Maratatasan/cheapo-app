CREATE FUNCTION poc.loadFixture(seed jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO poc.household
    SELECT id FROM jsonb_to_recordset(seed->'households') AS entry(id uuid);

  INSERT INTO poc.shop
    SELECT id, name FROM jsonb_to_recordset(seed->'shops') AS entry(id uuid, name text);

  INSERT INTO poc.saved_shop
    SELECT "householdId", "shopId", nickname
    FROM jsonb_populate_recordset(NULL::poc.saved_shop_payload, seed->'savedShops');

  SELECT poc.createProduct(product) FROM jsonb_array_elements(seed->'products') AS product;

  SELECT poc.createObservation(observation)
    FROM jsonb_array_elements(seed->'observations') AS observation;
$$;
