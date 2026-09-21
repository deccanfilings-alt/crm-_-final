-- ============================================================
-- 041_merge_duplicate_conversations
--
-- Consolidates fragmented conversation rows for the same contact
-- into a single unified conversation thread, migrates messages and reactions,
-- deletes empty duplicate conversation rows, and installs a UNIQUE index
-- preventing duplicate conversations going forward.
-- ============================================================

-- Step 1: Ensure all conversations have their account_id populated from contacts
UPDATE conversations c
SET account_id = ct.account_id
FROM contacts ct
WHERE c.contact_id = ct.id
  AND c.account_id IS NULL
  AND ct.account_id IS NOT NULL;

-- Step 2: Function to merge duplicate conversation rows
CREATE OR REPLACE FUNCTION public.merge_duplicate_conversations()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group RECORD;
  v_survivor UUID;
  v_losers UUID[];
  v_merged_count INTEGER := 0;
  v_latest_msg_at TIMESTAMPTZ;
  v_latest_msg_text TEXT;
  v_total_unread INTEGER;
  v_contact_account_id UUID;
BEGIN
  -- Group duplicate conversations by contact and channel
  FOR v_group IN
    SELECT contact_id,
           COALESCE(channel, 'whatsapp') AS conv_channel,
           array_agg(id ORDER BY last_message_at DESC NULLS LAST, created_at DESC) AS ids
    FROM conversations
    GROUP BY contact_id, COALESCE(channel, 'whatsapp')
    HAVING count(*) > 1
  LOOP
    v_survivor := v_group.ids[1];
    v_losers   := v_group.ids[2:array_length(v_group.ids, 1)];

    -- 1. Move all messages from loser conversations to survivor
    UPDATE messages
      SET conversation_id = v_survivor
      WHERE conversation_id = ANY(v_losers);

    -- 2. Move message reactions to survivor (skipping conflict if already exists)
    UPDATE message_reactions mr
      SET conversation_id = v_survivor
      WHERE mr.conversation_id = ANY(v_losers)
        AND NOT EXISTS (
          SELECT 1 FROM message_reactions s
          WHERE s.message_id = mr.message_id
            AND s.actor_type = mr.actor_type
            AND s.actor_id = mr.actor_id
        );
    DELETE FROM message_reactions WHERE conversation_id = ANY(v_losers);

    -- 3. Move deals pointing to loser conversations
    UPDATE deals
      SET conversation_id = v_survivor
      WHERE conversation_id = ANY(v_losers);

    -- 4. Move flow runs pointing to loser conversations
    UPDATE flow_runs
      SET conversation_id = v_survivor
      WHERE conversation_id = ANY(v_losers);

    -- 5. Calculate latest message and total unread count for survivor
    SELECT created_at, content_text
      INTO v_latest_msg_at, v_latest_msg_text
      FROM messages
      WHERE conversation_id = v_survivor
      ORDER BY created_at DESC
      LIMIT 1;

    SELECT COALESCE(SUM(unread_count), 0)
      INTO v_total_unread
      FROM conversations
      WHERE id = v_survivor OR id = ANY(v_losers);

    SELECT account_id INTO v_contact_account_id
      FROM contacts WHERE id = v_group.contact_id;

    -- 6. Update survivor conversation with consolidated metrics
    UPDATE conversations
      SET last_message_at = COALESCE(v_latest_msg_at, last_message_at),
          last_message_text = COALESCE(v_latest_msg_text, last_message_text),
          unread_count = v_total_unread,
          account_id = COALESCE(account_id, v_contact_account_id),
          updated_at = NOW()
      WHERE id = v_survivor;

    -- 7. Delete loser conversation rows
    DELETE FROM conversations WHERE id = ANY(v_losers);

    v_merged_count := v_merged_count + array_length(v_losers, 1);
  END LOOP;

  RETURN v_merged_count;
END;
$$;

-- Step 3: Run the cleanup function immediately to merge all existing duplicates
SELECT public.merge_duplicate_conversations();

-- Step 4: Enforce exactly one conversation per contact per channel
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_contact_channel
  ON conversations(contact_id, COALESCE(channel, 'whatsapp'));

-- Step 5: Update manual_merge_contacts to merge conversations properly
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

  -- 3. Consolidate conversations
  -- For channels where survivor doesn't have a conversation, re-point:
  UPDATE conversations loser_c
    SET contact_id = v_survivor
    WHERE loser_c.contact_id = v_loser
      AND NOT EXISTS (
        SELECT 1 FROM conversations surv_c
        WHERE surv_c.contact_id = v_survivor
          AND COALESCE(surv_c.channel, 'whatsapp') = COALESCE(loser_c.channel, 'whatsapp')
      );

  -- For channels where both have a conversation, move messages to survivor's conv:
  UPDATE messages m
    SET conversation_id = surv_c.id
    FROM conversations loser_c
    JOIN conversations surv_c
      ON surv_c.contact_id = v_survivor
      AND COALESCE(surv_c.channel, 'whatsapp') = COALESCE(loser_c.channel, 'whatsapp')
    WHERE m.conversation_id = loser_c.id
      AND loser_c.contact_id = v_loser;

  DELETE FROM conversations WHERE contact_id = v_loser;

  -- 4. Transfer other relational data
  UPDATE contact_notes                 SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE deals                         SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE broadcast_recipients          SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE automation_logs               SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE automation_pending_executions SET contact_id = v_survivor WHERE contact_id = v_loser;
  UPDATE action_items                  SET contact_id = v_survivor WHERE contact_id = v_loser;

  -- 5. Transfer Tags safely
  UPDATE contact_tags ct SET contact_id = v_survivor
    WHERE ct.contact_id = v_loser
      AND NOT EXISTS (
        SELECT 1 FROM contact_tags s
        WHERE s.contact_id = v_survivor AND s.tag_id = ct.tag_id
      );
  DELETE FROM contact_tags WHERE contact_id = v_loser;

  -- 6. Transfer Custom Fields safely
  UPDATE contact_custom_values cv SET contact_id = v_survivor
    WHERE cv.contact_id = v_loser
      AND NOT EXISTS (
        SELECT 1 FROM contact_custom_values s
        WHERE s.contact_id = v_survivor AND s.custom_field_id = cv.custom_field_id
      );
  DELETE FROM contact_custom_values WHERE contact_id = v_loser;

  -- 7. Re-point non-active flow_runs
  UPDATE flow_runs SET contact_id = v_survivor
    WHERE contact_id = v_loser AND status <> 'active';

  -- 8. Carry over missing social identities and phone
  UPDATE contacts SET
    instagram_id = COALESCE(instagram_id, v_loser_ig_id),
    instagram_username = COALESCE(instagram_username, v_loser_ig_user),
    facebook_psid = COALESCE(facebook_psid, v_loser_fb_id),
    phone = COALESCE(NULLIF(phone, ''), NULLIF(v_loser_phone, ''))
  WHERE id = v_survivor;

  -- 9. Delete the loser
  DELETE FROM contacts WHERE id = v_loser;
END;
$$;
