-- Migration 051: Team Chat Direct Messaging and Message Deletion RLS updates
-- Extends team_rooms with is_direct and dm_user_ids columns, and adjusts RLS for 1-on-1 chats.

-- 1. Add direct message columns to team_rooms
ALTER TABLE team_rooms ADD COLUMN IF NOT EXISTS is_direct BOOLEAN DEFAULT FALSE;
ALTER TABLE team_rooms ADD COLUMN IF NOT EXISTS dm_user_ids UUID[] DEFAULT '{}'::UUID[];

-- 2. Index for fast lookup of direct messages by participant
CREATE INDEX IF NOT EXISTS idx_team_rooms_dm_users ON team_rooms USING GIN (dm_user_ids);
CREATE INDEX IF NOT EXISTS idx_team_rooms_is_direct ON team_rooms(is_direct);

-- 3. Update SELECT policy for team_rooms
-- Public rooms: all members of the account can view
-- Direct rooms: only the two participants can view
DROP POLICY IF EXISTS team_rooms_select ON team_rooms;
CREATE POLICY team_rooms_select ON team_rooms FOR SELECT
  USING (
    is_account_member(account_id) AND (
      NOT COALESCE(is_direct, FALSE) OR auth.uid() = ANY(dm_user_ids)
    )
  );

-- 4. Allow any account member to create direct message rooms (1-on-1)
-- Public group rooms still require admin role
DROP POLICY IF EXISTS team_rooms_insert ON team_rooms;
CREATE POLICY team_rooms_insert ON team_rooms FOR INSERT
  WITH CHECK (
    is_account_member(account_id) AND (
      (COALESCE(is_direct, FALSE) = TRUE AND auth.uid() = ANY(dm_user_ids))
      OR
      (COALESCE(is_direct, FALSE) = FALSE AND is_account_member(account_id, 'admin'))
    )
  );

-- 5. Ensure team_messages_delete policy allows author or admin/owner to delete messages
DROP POLICY IF EXISTS team_messages_delete ON team_messages;
CREATE POLICY team_messages_delete ON team_messages FOR DELETE
  USING (
    is_account_member(account_id) AND (
      sender_id = auth.uid() OR is_account_member(account_id, 'admin')
    )
  );
