-- Migration 049: Internal Team Chat Rooms with Teammate Mentions and Customer Contact Tagging
-- Creates team_rooms, team_messages, and team_message_reactions tables with tenant RLS.

-- ============================================================
-- 1. TEAM_ROOMS (Group chat channels: #general, #sales, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_team_rooms_account_name UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_team_rooms_account ON team_rooms(account_id);

ALTER TABLE team_rooms ENABLE ROW LEVEL SECURITY;

-- All members of the account can view team rooms
DROP POLICY IF EXISTS team_rooms_select ON team_rooms;
CREATE POLICY team_rooms_select ON team_rooms FOR SELECT
  USING (is_account_member(account_id));

-- Only Owner and Admins can create new rooms (per user requirement)
DROP POLICY IF EXISTS team_rooms_insert ON team_rooms;
CREATE POLICY team_rooms_insert ON team_rooms FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Only Owner and Admins can update rooms
DROP POLICY IF EXISTS team_rooms_update ON team_rooms;
CREATE POLICY team_rooms_update ON team_rooms FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- Only Owner and Admins can delete rooms
DROP POLICY IF EXISTS team_rooms_delete ON team_rooms;
CREATE POLICY team_rooms_delete ON team_rooms FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- 2. TEAM_MESSAGES (Chat messages within rooms)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES team_rooms(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  mentioned_user_ids UUID[] DEFAULT '{}'::UUID[],
  tagged_contact_ids UUID[] DEFAULT '{}'::UUID[],
  reply_to_id UUID REFERENCES team_messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_messages_room_created ON team_messages(room_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_team_messages_account ON team_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_team_messages_sender ON team_messages(sender_id);

ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;

-- All members of the account can read messages in their rooms
DROP POLICY IF EXISTS team_messages_select ON team_messages;
CREATE POLICY team_messages_select ON team_messages FOR SELECT
  USING (is_account_member(account_id));

-- Any account member can send messages as themselves
DROP POLICY IF EXISTS team_messages_insert ON team_messages;
CREATE POLICY team_messages_insert ON team_messages FOR INSERT
  WITH CHECK (is_account_member(account_id) AND sender_id = auth.uid());

-- Author or Admins can delete a message
DROP POLICY IF EXISTS team_messages_delete ON team_messages;
CREATE POLICY team_messages_delete ON team_messages FOR DELETE
  USING (is_account_member(account_id) AND (sender_id = auth.uid() OR is_account_member(account_id, 'admin')));

-- Author can edit their own message
DROP POLICY IF EXISTS team_messages_update ON team_messages;
CREATE POLICY team_messages_update ON team_messages FOR UPDATE
  USING (is_account_member(account_id) AND sender_id = auth.uid())
  WITH CHECK (is_account_member(account_id) AND sender_id = auth.uid());

-- ============================================================
-- 3. TEAM_MESSAGE_REACTIONS (Emoji reactions on messages)
-- ============================================================
CREATE TABLE IF NOT EXISTS team_message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES team_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_team_reactions_user UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_team_reactions_message ON team_message_reactions(message_id);

ALTER TABLE team_message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_message_reactions_select ON team_message_reactions;
CREATE POLICY team_message_reactions_select ON team_message_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_messages m
      WHERE m.id = team_message_reactions.message_id
        AND is_account_member(m.account_id)
    )
  );

DROP POLICY IF EXISTS team_message_reactions_insert ON team_message_reactions;
CREATE POLICY team_message_reactions_insert ON team_message_reactions FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM team_messages m
      WHERE m.id = team_message_reactions.message_id
        AND is_account_member(m.account_id)
    )
  );

DROP POLICY IF EXISTS team_message_reactions_delete ON team_message_reactions;
CREATE POLICY team_message_reactions_delete ON team_message_reactions FOR DELETE
  USING (user_id = auth.uid());

-- ============================================================
-- 4. REALTIME PUBLICATION
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'team_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'team_message_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_message_reactions;
  END IF;
END $$;
