-- ============================================================
-- 070_co_owners.sql
--
-- Allow more than one Owner per account (co-owners, e.g. founder + CEO).
--
-- Rules:
--   - Only an existing owner can make another member a co-owner.
--   - Nobody can demote or remove an owner except that owner, by
--     stepping down (set_member_role / remove_account_member already
--     refuse to touch owner rows).
--   - An account always keeps at least one owner: the last owner
--     cannot step down.
--   - accounts.owner_user_id stays as the "primary" owner pointer that
--     older code relies on. If the primary owner steps down, it moves
--     to another remaining owner.
--   - Any owner (not only the primary one) may edit bank / UPI details.
--
-- Idempotent — safe to run more than once.
-- ============================================================

-- §1. Make a member a co-owner
CREATE OR REPLACE FUNCTION public.make_co_owner(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role INTO v_caller_account_id, v_caller_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;
  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only an owner can add a co-owner' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role INTO v_target_account_id, v_target_role
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;
  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
  END IF;
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'This member is already an owner' USING ERRCODE = '22023';
  END IF;

  UPDATE profiles SET account_role = 'owner' WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.make_co_owner(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.make_co_owner(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.make_co_owner(UUID) TO authenticated;

-- §2. An owner steps down to admin (never the last owner)
CREATE OR REPLACE FUNCTION public.step_down_as_owner()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_role account_role_enum;
  v_other_owner UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role INTO v_account_id, v_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_account_id IS NULL OR v_role <> 'owner' THEN
    RAISE EXCEPTION 'Only an owner can step down' USING ERRCODE = '42501';
  END IF;

  -- Lock the account's owner rows so two owners can't both step down
  -- at the same moment and leave the account with none.
  PERFORM 1 FROM profiles
   WHERE account_id = v_account_id AND account_role = 'owner'
   FOR UPDATE;

  SELECT user_id INTO v_other_owner
  FROM profiles
  WHERE account_id = v_account_id
    AND account_role = 'owner'
    AND user_id <> auth.uid()
  ORDER BY created_at
  LIMIT 1;

  IF v_other_owner IS NULL THEN
    RAISE EXCEPTION 'You are the only owner. Make someone else a co-owner (or transfer ownership) first.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE profiles SET account_role = 'admin' WHERE user_id = auth.uid();

  UPDATE accounts SET owner_user_id = v_other_owner
  WHERE id = v_account_id AND owner_user_id = auth.uid();
END;
$$;

ALTER FUNCTION public.step_down_as_owner() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.step_down_as_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.step_down_as_owner() TO authenticated;

-- §3. Bank / UPI details: any owner of the account, not only the primary one
CREATE OR REPLACE FUNCTION public.guard_bank_details()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.bank_name, NEW.bank_account_no, NEW.bank_ifsc, NEW.bank_beneficiary_name, NEW.upi_id, NEW.upi_qr_url)
         IS DISTINCT FROM
         (OLD.bank_name, OLD.bank_account_no, OLD.bank_ifsc, OLD.bank_beneficiary_name, OLD.upi_id, OLD.upi_qr_url)
     AND NOT EXISTS (
       SELECT 1 FROM profiles p
       WHERE p.user_id = auth.uid()
         AND p.account_id = NEW.account_id
         AND p.account_role = 'owner'
     )
  THEN
    RAISE EXCEPTION 'Only an account owner can change bank or UPI details';
  END IF;
  RETURN NEW;
END $$;

NOTIFY pgrst, 'reload schema';
