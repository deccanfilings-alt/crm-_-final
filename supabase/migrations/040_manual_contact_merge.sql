-- ============================================================
-- 040_manual_contact_merge
--
-- Exposes a manual merge function allowing a team leader or owner
-- to manually merge a "loser" contact into a "survivor" contact.
-- Moves all related data and cleans up the loser.
-- ============================================================

CREATE OR REPLACE FUNCTION public.manual_merge_contacts(v_survivor UUID, v_loser UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role account_role_enum;
  v_caller_account_id UUID;
  v_survivor_account_id UUID;
  v_loser_account_id UUID;
  v_loser_ig_id TEXT;
  v_loser_ig_user TEXT;
  v_loser_fb_id TEXT;
  v_loser_phone TEXT;
BEGIN
  -- 1. Resolve caller auth
  SELECT account_id, account_role INTO v_caller_account_id, v_caller_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Requires Team Leader or Owner role to merge contacts';
  END IF;

  -- 2. Verify both contacts exist and belong to the caller's account
  SELECT account_id INTO v_survivor_account_id FROM contacts WHERE id = v_survivor;
  SELECT account_id, instagram_id, instagram_username, facebook_psid, phone INTO v_loser_account_id, v_loser_ig_id, v_loser_ig_user, v_loser_fb_id, v_loser_phone 
  FROM contacts WHERE id = v_loser;

  IF v_survivor_account_id IS NULL OR v_loser_account_id IS NULL THEN
    RAISE EXCEPTION 'One or both contacts do not exist';
  END IF;

  IF v_survivor_account_id <> v_caller_account_id OR v_loser_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Contacts do not belong to your account';
  END IF;

  IF v_survivor = v_loser THEN
    RAISE EXCEPTION 'Cannot merge a contact into itself';
  END IF;

  -- 3. Transfer relational data
  UPDATE conversations                 SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE contact_notes                 SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE deals                         SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE broadcast_recipients          SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE automation_logs               SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE automation_pending_executions SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE action_items                  SET contact_id = v_survivor WHERE contact_id = v_loser;

  -- 4. Transfer Tags safely (avoiding UNIQUE constraints)
  UPDATE contact_tags ct SET contact_id = v_survivor
    WHERE ct.contact_id = v_loser
      AND NOT EXISTS (
        SELECT 1 FROM contact_tags s
        WHERE s.contact_id = v_survivor AND s.tag_id = ct.tag_id
      );
  DELETE FROM contact_tags WHERE contact_id = v_loser;

  -- 5. Transfer Custom Fields safely
  UPDATE contact_custom_values cv SET contact_id = v_survivor
    WHERE cv.contact_id = v_loser
      AND NOT EXISTS (
        SELECT 1 FROM contact_custom_values s
        WHERE s.contact_id = v_survivor AND s.custom_field_id = cv.custom_field_id
      );
  DELETE FROM contact_custom_values WHERE contact_id = v_loser;

  -- 6. Re-point non-active flow_runs
  UPDATE flow_runs SET contact_id = v_survivor
    WHERE contact_id = v_loser AND status <> 'active';

  -- 7. Carry over missing social identities and phone
  UPDATE contacts SET
    instagram_id = COALESCE(instagram_id, v_loser_ig_id),
    instagram_username = COALESCE(instagram_username, v_loser_ig_user),
    facebook_psid = COALESCE(facebook_psid, v_loser_fb_id),
    phone = COALESCE(NULLIF(phone, ''), NULLIF(v_loser_phone, ''))
  WHERE id = v_survivor;

  -- 8. Delete the loser (cascades or sets remaining nulls)
  DELETE FROM contacts WHERE id = v_loser;
END;
$$;

ALTER FUNCTION public.manual_merge_contacts(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.manual_merge_contacts(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manual_merge_contacts(UUID, UUID) TO authenticated;
