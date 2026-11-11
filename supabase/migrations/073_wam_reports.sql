-- ============================================================
-- 073_wam_reports.sql
--
-- Attendance & productivity reporting on top of 072 (WAM).
--
--   wam_settings        one row per account: office start time,
--                       grace minutes, minimum daily hours. One
--                       rule for everyone. Owners/Team Leaders edit.
--   wam_daily(from,to)  per person per India-date: first in, last
--                       out, minutes worked (breaks excluded),
--                       break minutes, shifts, still-open flag.
--   wam_productivity(from,to)
--                       per person: WhatsApp replies sent, chats
--                       assigned, action items completed in range,
--                       and action items overdue right now.
--
-- Both functions aggregate inside Postgres (no 1000-row API cap)
-- and scope themselves: owners/Team Leaders get the whole account,
-- everyone else gets only their own rows.
-- Dates are India dates (Asia/Kolkata), inclusive.
-- Idempotent — safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS wam_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  workday_start TIME NOT NULL DEFAULT '10:00',
  grace_minutes INTEGER NOT NULL DEFAULT 15 CHECK (grace_minutes BETWEEN 0 AND 240),
  min_daily_minutes INTEGER NOT NULL DEFAULT 480 CHECK (min_daily_minutes BETWEEN 0 AND 1440),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wam_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wam_settings_select ON wam_settings;
CREATE POLICY wam_settings_select ON wam_settings FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS wam_settings_insert ON wam_settings;
CREATE POLICY wam_settings_insert ON wam_settings FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS wam_settings_update ON wam_settings;
CREATE POLICY wam_settings_update ON wam_settings FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

-- ------------------------------------------------------------
-- wam_daily
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_daily(p_from DATE, p_to DATE)
RETURNS TABLE (
  user_id UUID,
  day DATE,
  first_in TIMESTAMPTZ,
  last_out TIMESTAMPTZ,
  worked_minutes INTEGER,
  break_minutes INTEGER,
  shifts INTEGER,
  is_open BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.account_id, p.user_id AS uid, is_account_member(p.account_id, 'admin') AS is_admin
      FROM profiles p
     WHERE p.user_id = auth.uid() AND is_account_member(p.account_id)
  ),
  s AS (
    SELECT sh.id, sh.user_id, sh.clock_in, sh.clock_out, sh.status,
           (sh.clock_in AT TIME ZONE 'Asia/Kolkata')::date AS d,
           COALESCE(sh.clock_out, NOW()) AS end_at
      FROM wam_shifts sh, me
     WHERE sh.account_id = me.account_id
       AND (me.is_admin OR sh.user_id = me.uid)
       AND sh.clock_in >= (p_from::timestamp AT TIME ZONE 'Asia/Kolkata')
       AND sh.clock_in <  ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata')
  ),
  b AS (
    SELECT br.shift_id,
           SUM(EXTRACT(EPOCH FROM (COALESCE(br.ended_at, NOW()) - br.started_at))) AS secs
      FROM wam_breaks br
      JOIN s ON s.id = br.shift_id
     GROUP BY br.shift_id
  )
  SELECT s.user_id,
         s.d,
         MIN(s.clock_in),
         CASE WHEN BOOL_OR(s.status <> 'completed') THEN NULL ELSE MAX(s.clock_out) END,
         FLOOR(SUM(GREATEST(0, EXTRACT(EPOCH FROM (s.end_at - s.clock_in)) - COALESCE(b.secs, 0))) / 60)::int,
         FLOOR(SUM(COALESCE(b.secs, 0)) / 60)::int,
         COUNT(*)::int,
         BOOL_OR(s.status <> 'completed')
    FROM s
    LEFT JOIN b ON b.shift_id = s.id
   GROUP BY s.user_id, s.d
$$;

-- ------------------------------------------------------------
-- wam_productivity
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_productivity(p_from DATE, p_to DATE)
RETURNS TABLE (
  user_id UUID,
  messages_sent INTEGER,
  chats_assigned INTEGER,
  tasks_completed INTEGER,
  tasks_overdue INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT p.account_id, p.user_id AS uid, is_account_member(p.account_id, 'admin') AS is_admin
      FROM profiles p
     WHERE p.user_id = auth.uid() AND is_account_member(p.account_id)
  ),
  rng AS (
    SELECT (p_from::timestamp AT TIME ZONE 'Asia/Kolkata') AS t0,
           ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') AS t1
  ),
  members AS (
    SELECT pr.user_id
      FROM profiles pr, me
     WHERE pr.account_id = me.account_id
       AND (me.is_admin OR pr.user_id = me.uid)
  ),
  msg AS (
    SELECT m.sender_id AS uid, COUNT(*) AS n
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id, me, rng
     WHERE c.account_id = me.account_id
       AND m.sender_type = 'agent'
       AND NOT COALESCE(m.is_internal, FALSE)
       AND m.created_at >= rng.t0 AND m.created_at < rng.t1
     GROUP BY m.sender_id
  ),
  conv AS (
    SELECT c.assigned_agent_id AS uid, COUNT(*) AS n
      FROM conversations c, me, rng
     WHERE c.account_id = me.account_id
       AND c.assigned_at >= rng.t0 AND c.assigned_at < rng.t1
     GROUP BY c.assigned_agent_id
  ),
  done AS (
    SELECT a.assignee_id AS uid, COUNT(*) AS n
      FROM action_items a, me, rng
     WHERE a.account_id = me.account_id
       AND a.status = 'completed'
       AND a.completed_at >= rng.t0 AND a.completed_at < rng.t1
     GROUP BY a.assignee_id
  ),
  late AS (
    SELECT a.assignee_id AS uid, COUNT(*) AS n
      FROM action_items a, me
     WHERE a.account_id = me.account_id
       AND a.status IN ('todo', 'in_progress', 'review')
       AND a.target_date < (NOW() AT TIME ZONE 'Asia/Kolkata')::date
     GROUP BY a.assignee_id
  )
  SELECT mb.user_id,
         COALESCE(msg.n, 0)::int,
         COALESCE(conv.n, 0)::int,
         COALESCE(done.n, 0)::int,
         COALESCE(late.n, 0)::int
    FROM members mb
    LEFT JOIN msg  ON msg.uid  = mb.user_id
    LEFT JOIN conv ON conv.uid = mb.user_id
    LEFT JOIN done ON done.uid = mb.user_id
    LEFT JOIN late ON late.uid = mb.user_id
$$;

REVOKE ALL ON FUNCTION wam_daily(DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION wam_productivity(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wam_daily(DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION wam_productivity(DATE, DATE) TO authenticated;

NOTIFY pgrst, 'reload schema';
