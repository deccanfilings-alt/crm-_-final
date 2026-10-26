-- Migration 059: Team Chat Privacy, Read State, and Attachments
-- Enforces room visibility rules for team_rooms, team_messages, and team_message_reactions.

-- ============================================================
-- §1. One visibility rule for rooms, used everywhere
-- ============================================================
ALTER TABLE team_rooms ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

-- Members of private team rooms (used by optional Task 9; created now because the rule references it)
CREATE TABLE IF NOT EXISTS team_room_members (
  room_id UUID NOT NULL REFERENCES team_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE team_room_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_team_room(p_room_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM team_rooms r
    WHERE r.id = p_room_id
      AND is_account_member(r.account_id)
      AND CASE
            -- DMs: only the two participants. Admins and owners do NOT see DMs.
            WHEN COALESCE(r.is_direct, FALSE) THEN auth.uid() = ANY (r.dm_user_ids)
            -- Private team rooms: members, plus admins and owners
            WHEN r.is_private THEN
              is_account_member(r.account_id, 'admin')
              OR EXISTS (SELECT 1 FROM team_room_members m
                         WHERE m.room_id = r.id AND m.user_id = auth.uid())
            ELSE TRUE
          END
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_view_team_room(UUID) TO authenticated;

DROP POLICY IF EXISTS team_rooms_select ON team_rooms;
CREATE POLICY team_rooms_select ON team_rooms FOR SELECT
  USING (public.can_view_team_room(id));

DROP POLICY IF EXISTS team_room_members_select ON team_room_members;
CREATE POLICY team_room_members_select ON team_room_members FOR SELECT
  USING (public.can_view_team_room(room_id));

DROP POLICY IF EXISTS team_room_members_write ON team_room_members;
CREATE POLICY team_room_members_write ON team_room_members FOR ALL
  USING (EXISTS (SELECT 1 FROM team_rooms r WHERE r.id = room_id AND is_account_member(r.account_id, 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM team_rooms r WHERE r.id = room_id AND is_account_member(r.account_id, 'admin')));

-- ============================================================
-- §2. Messages and reactions follow the room rule
-- ============================================================
DROP POLICY IF EXISTS team_messages_select ON team_messages;
CREATE POLICY team_messages_select ON team_messages FOR SELECT
  USING (public.can_view_team_room(room_id));

DROP POLICY IF EXISTS team_messages_insert ON team_messages;
CREATE POLICY team_messages_insert ON team_messages FOR INSERT
  WITH CHECK (sender_id = auth.uid() AND public.can_view_team_room(room_id));

DROP POLICY IF EXISTS team_message_reactions_select ON team_message_reactions;
CREATE POLICY team_message_reactions_select ON team_message_reactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM team_messages m
                 WHERE m.id = team_message_reactions.message_id
                   AND public.can_view_team_room(m.room_id)));

DROP POLICY IF EXISTS team_message_reactions_insert ON team_message_reactions;
CREATE POLICY team_message_reactions_insert ON team_message_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid()
              AND EXISTS (SELECT 1 FROM team_messages m
                          WHERE m.id = team_message_reactions.message_id
                            AND public.can_view_team_room(m.room_id)));

-- ============================================================
-- §3. Read state per person per room
-- ============================================================
CREATE TABLE IF NOT EXISTS team_room_reads (
  room_id UUID NOT NULL REFERENCES team_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
ALTER TABLE team_room_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_room_reads_own ON team_room_reads;
CREATE POLICY team_room_reads_own ON team_room_reads FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.can_view_team_room(room_id));

-- Everyone starts with nothing unread
INSERT INTO team_room_reads (room_id, user_id, last_read_at)
SELECT r.id, p.user_id, NOW()
FROM team_rooms r
JOIN profiles p ON p.account_id = r.account_id
WHERE NOT COALESCE(r.is_direct, FALSE) OR p.user_id = ANY (r.dm_user_ids)
ON CONFLICT (room_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.team_chat_unread_counts()
RETURNS TABLE (room_id UUID, unread BIGINT, last_read_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visible AS (
    SELECT r.id FROM team_rooms r
    WHERE is_account_member(r.account_id) AND public.can_view_team_room(r.id)
  ),
  reads AS (
    SELECT v.id AS room_id,
           -- a room never opened counts only the last 7 days as unread
           COALESCE(rr.last_read_at, NOW() - INTERVAL '7 days') AS last_read_at
    FROM visible v
    LEFT JOIN team_room_reads rr ON rr.room_id = v.id AND rr.user_id = auth.uid()
  )
  SELECT rd.room_id, COUNT(m.id) AS unread, rd.last_read_at
  FROM reads rd
  LEFT JOIN team_messages m
    ON m.room_id = rd.room_id
   AND m.created_at > rd.last_read_at
   AND m.sender_id <> auth.uid()
  GROUP BY rd.room_id, rd.last_read_at;
$$;
GRANT EXECUTE ON FUNCTION public.team_chat_unread_counts() TO authenticated;
