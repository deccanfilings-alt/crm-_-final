-- ============================================================
-- 072_wam_time_tracking.sql
--
-- WAM — work attendance: clock in, breaks, clock out.
--
--   wam_shifts  one row per working shift. status:
--                 active    = clocked in and working
--                 paused    = on a break (one open wam_breaks row)
--                 completed = clocked out
--               total_minutes = minutes WORKED (breaks excluded),
--               filled at clock-out. break_minutes likewise.
--   wam_breaks  one row per break inside a shift.
--
-- Integrity: users can only READ through RLS. Every change goes
-- through wam_transition(action), a SECURITY DEFINER function
-- that stamps server time (now()), so nobody can back-date a
-- clock-in from the browser. A user can have at most one open
-- (active/paused) shift — enforced by a partial unique index.
--
-- Visibility: you see your own shifts; owners and Team Leaders
-- (admin) see everyone in the account.
-- Idempotent — safe to run more than once.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE wam_shift_status AS ENUM ('active', 'paused', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS wam_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clock_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  clock_out TIMESTAMPTZ,
  status wam_shift_status NOT NULL DEFAULT 'active',
  total_minutes INTEGER,
  break_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (clock_out IS NULL OR clock_out >= clock_in),
  CHECK ((status = 'completed') = (clock_out IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wam_shifts_one_open
  ON wam_shifts(user_id) WHERE status <> 'completed';
CREATE INDEX IF NOT EXISTS idx_wam_shifts_account_day
  ON wam_shifts(account_id, clock_in DESC);
CREATE INDEX IF NOT EXISTS idx_wam_shifts_user
  ON wam_shifts(user_id, clock_in DESC);

CREATE TABLE IF NOT EXISTS wam_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES wam_shifts(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wam_breaks_one_open
  ON wam_breaks(shift_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wam_breaks_shift ON wam_breaks(shift_id);

ALTER TABLE wam_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE wam_breaks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wam_shifts_select ON wam_shifts;
CREATE POLICY wam_shifts_select ON wam_shifts FOR SELECT
  USING (
    (user_id = auth.uid() AND is_account_member(account_id))
    OR is_account_member(account_id, 'admin')
  );

DROP POLICY IF EXISTS wam_breaks_select ON wam_breaks;
CREATE POLICY wam_breaks_select ON wam_breaks FOR SELECT
  USING (
    (user_id = auth.uid() AND is_account_member(account_id))
    OR is_account_member(account_id, 'admin')
  );
-- No insert/update/delete policies: writes only via wam_transition().

-- ------------------------------------------------------------
-- wam_transition(action) — the whole state machine.
--   clock_in     Clocked Out -> active
--   start_break  active      -> paused   (opens a break)
--   resume       paused      -> active   (closes the break)
--   clock_out    active|paused -> completed (closes any open break,
--                computes total_minutes / break_minutes)
-- Errors: 22023 = action not valid in the current state.
-- Returns the affected shift as JSON.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION wam_transition(p_action TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_account UUID;
  v_shift wam_shifts%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_break_secs NUMERIC;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_uid;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'viewer') THEN
    RAISE EXCEPTION 'No account' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_shift FROM wam_shifts
   WHERE user_id = v_uid AND status <> 'completed'
   FOR UPDATE;

  IF p_action = 'clock_in' THEN
    IF FOUND THEN
      RAISE EXCEPTION 'You are already clocked in' USING ERRCODE = '22023';
    END IF;
    INSERT INTO wam_shifts (account_id, user_id, clock_in, status)
    VALUES (v_account, v_uid, v_now, 'active')
    RETURNING * INTO v_shift;

  ELSIF p_action = 'start_break' THEN
    IF NOT FOUND OR v_shift.status <> 'active' THEN
      RAISE EXCEPTION 'You need to be working to take a break' USING ERRCODE = '22023';
    END IF;
    INSERT INTO wam_breaks (shift_id, account_id, user_id, started_at)
    VALUES (v_shift.id, v_shift.account_id, v_uid, v_now);
    UPDATE wam_shifts SET status = 'paused' WHERE id = v_shift.id
    RETURNING * INTO v_shift;

  ELSIF p_action = 'resume' THEN
    IF NOT FOUND OR v_shift.status <> 'paused' THEN
      RAISE EXCEPTION 'You are not on a break' USING ERRCODE = '22023';
    END IF;
    UPDATE wam_breaks SET ended_at = v_now
     WHERE shift_id = v_shift.id AND ended_at IS NULL;
    UPDATE wam_shifts SET status = 'active' WHERE id = v_shift.id
    RETURNING * INTO v_shift;

  ELSIF p_action = 'clock_out' THEN
    IF NOT FOUND THEN
      RAISE EXCEPTION 'You are not clocked in' USING ERRCODE = '22023';
    END IF;
    UPDATE wam_breaks SET ended_at = v_now
     WHERE shift_id = v_shift.id AND ended_at IS NULL;
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))), 0)
      INTO v_break_secs
      FROM wam_breaks WHERE shift_id = v_shift.id;
    UPDATE wam_shifts
       SET status = 'completed',
           clock_out = v_now,
           break_minutes = FLOOR(v_break_secs / 60),
           total_minutes = GREATEST(0, FLOOR((EXTRACT(EPOCH FROM (v_now - clock_in)) - v_break_secs) / 60))
     WHERE id = v_shift.id
    RETURNING * INTO v_shift;

  ELSE
    RAISE EXCEPTION 'Unknown action %', p_action USING ERRCODE = '22023';
  END IF;

  RETURN row_to_json(v_shift);
END;
$$;

REVOKE ALL ON FUNCTION wam_transition(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION wam_transition(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
