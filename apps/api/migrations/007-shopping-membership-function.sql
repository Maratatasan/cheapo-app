BEGIN;

CREATE FUNCTION cheapo.resolve_shopping_member(credential_digest text, lock_household boolean)
RETURNS TABLE (household_id uuid, shopper_id uuid, active boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  member RECORD;
BEGIN
  SELECT credential.household_id, credential.shopper_id, membership.revoked_at IS NULL AS active
  INTO member
  FROM cheapo.shopper_credential AS credential
  JOIN cheapo.household_membership AS membership USING (household_id, shopper_id)
  WHERE credential.token_digest = credential_digest
    AND credential.revoked_at IS NULL
    AND credential.expires_at > statement_timestamp()
  FOR SHARE OF credential, membership;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Only a credential scoped to an active membership may lock its own household.
  IF lock_household AND member.active THEN
    PERFORM 1 FROM cheapo.household AS home WHERE home.id = member.household_id FOR UPDATE;
  END IF;

  RETURN QUERY SELECT member.household_id, member.shopper_id, member.active;
END
$$;

REVOKE ALL ON FUNCTION cheapo.resolve_shopping_member(text, boolean) FROM PUBLIC;

COMMIT;
