-- 061_kpi_targets.sql
-- Table: kpi_targets
CREATE TABLE IF NOT EXISTS kpi_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN ('tasks_completed_on_time', 'deals_won', 'quotes_sent', 'quotes_accepted', 'amount_collected')),
  period TEXT NOT NULL CHECK (period IN ('week', 'month')),
  period_start DATE NOT NULL,
  target_value NUMERIC NOT NULL CHECK (target_value >= 0),
  created_by UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_kpi_target UNIQUE (account_id, user_id, metric, period, period_start)
);

CREATE INDEX IF NOT EXISTS idx_kpi_targets_account_user ON kpi_targets(account_id, user_id, period, period_start);

ALTER TABLE kpi_targets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kpi_targets' AND policyname = 'kpi_targets_account_member_select'
  ) THEN
    CREATE POLICY kpi_targets_account_member_select ON kpi_targets
      FOR SELECT USING (
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kpi_targets' AND policyname = 'kpi_targets_insert'
  ) THEN
    CREATE POLICY kpi_targets_insert ON kpi_targets
      FOR INSERT WITH CHECK (
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kpi_targets' AND policyname = 'kpi_targets_update'
  ) THEN
    CREATE POLICY kpi_targets_update ON kpi_targets
      FOR UPDATE USING (
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'kpi_targets' AND policyname = 'kpi_targets_delete'
  ) THEN
    CREATE POLICY kpi_targets_delete ON kpi_targets
      FOR DELETE USING (
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
      );
  END IF;
END $$;

-- RPC: kpi_progress
CREATE OR REPLACE FUNCTION kpi_progress(
  p_account_id UUID,
  p_period_start DATE,
  p_period TEXT
)
RETURNS TABLE (
  target_id UUID,
  user_id UUID,
  metric TEXT,
  period TEXT,
  period_start DATE,
  target_value NUMERIC,
  actual_value NUMERIC,
  percentage NUMERIC,
  created_by UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_end DATE;
BEGIN
  IF p_period = 'month' THEN
    v_period_end := (p_period_start + INTERVAL '1 month')::DATE;
  ELSE
    v_period_end := (p_period_start + INTERVAL '7 days')::DATE;
  END IF;

  RETURN QUERY
  WITH calculated AS (
    SELECT
      t.id AS target_id,
      t.user_id,
      t.metric,
      t.period,
      t.period_start,
      t.target_value,
      t.created_by,
      CASE
        WHEN t.metric = 'tasks_completed_on_time' THEN (
          SELECT COUNT(*)::NUMERIC
          FROM action_items a
          WHERE a.account_id = p_account_id
            AND (a.assignee_id = t.user_id OR a.agent_id = t.user_id)
            AND a.status = 'completed'
            AND a.completed_at IS NOT NULL
            AND a.completed_at >= p_period_start::TIMESTAMPTZ
            AND a.completed_at < v_period_end::TIMESTAMPTZ
            AND a.completed_at::DATE <= a.target_date
        )
        WHEN t.metric = 'deals_won' THEN (
          SELECT COUNT(*)::NUMERIC
          FROM deals d
          WHERE d.account_id = p_account_id
            AND d.assigned_to = t.user_id
            AND d.status = 'won'
            AND d.updated_at >= p_period_start::TIMESTAMPTZ
            AND d.updated_at < v_period_end::TIMESTAMPTZ
        )
        WHEN t.metric = 'quotes_sent' THEN (
          SELECT COUNT(*)::NUMERIC
          FROM quotations q
          WHERE q.account_id = p_account_id
            AND q.created_by_user_id = t.user_id
            AND q.sent_at IS NOT NULL
            AND q.sent_at >= p_period_start::TIMESTAMPTZ
            AND q.sent_at < v_period_end::TIMESTAMPTZ
        )
        WHEN t.metric = 'quotes_accepted' THEN (
          SELECT COUNT(*)::NUMERIC
          FROM quotations q
          WHERE q.account_id = p_account_id
            AND q.created_by_user_id = t.user_id
            AND q.accepted_at IS NOT NULL
            AND q.accepted_at >= p_period_start::TIMESTAMPTZ
            AND q.accepted_at < v_period_end::TIMESTAMPTZ
        )
        WHEN t.metric = 'amount_collected' THEN (
          SELECT COALESCE(SUM(q.total_amount), 0)::NUMERIC
          FROM quotations q
          WHERE q.account_id = p_account_id
            AND q.created_by_user_id = t.user_id
            AND q.accepted_at IS NOT NULL
            AND q.accepted_at >= p_period_start::TIMESTAMPTZ
            AND q.accepted_at < v_period_end::TIMESTAMPTZ
        )
        ELSE 0::NUMERIC
      END AS actual_value
    FROM kpi_targets t
    WHERE t.account_id = p_account_id
      AND t.period = p_period
      AND t.period_start = p_period_start
  )
  SELECT
    c.target_id,
    c.user_id,
    c.metric,
    c.period,
    c.period_start,
    c.target_value,
    c.actual_value,
    CASE
      WHEN c.target_value > 0 THEN ROUND((c.actual_value / c.target_value * 100)::NUMERIC, 1)
      ELSE 0::NUMERIC
    END AS percentage,
    c.created_by
  FROM calculated c;
END;
$$;
