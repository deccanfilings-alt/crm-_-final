-- 067_security_hotfix.sql
-- Security Hotfix from 29 Oct review:
-- 1. Task attachments: only own account can read/insert
-- 2. Chat & flow media: member-only read policy
-- 3. Invoices & quotation settings: protect bank and UPI details from being swapped
-- 4. KPI progress: account membership check, B5 deals_won fix, and revoke public execution

-- 1. Task attachments (storage)
DROP POLICY IF EXISTS task_files_authenticated_select ON storage.objects;
DROP POLICY IF EXISTS task_files_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS task_files_member_select ON storage.objects;
DROP POLICY IF EXISTS task_files_member_insert ON storage.objects;

CREATE POLICY task_files_member_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'task-files' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]));

CREATE POLICY task_files_member_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'task-files' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]));

-- 2. Chat media & flow media (storage)
DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "chat media: members read" ON storage.objects;
CREATE POLICY "chat media: members read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chat-media' AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]));

DROP POLICY IF EXISTS "Flow media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "flow media: members read" ON storage.objects;
CREATE POLICY "flow media: members read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'flow-media' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1])));

-- 3. Guard bank & UPI details
CREATE OR REPLACE FUNCTION public.invoices_snapshot_bank()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT s.bank_name, s.bank_account_no, s.bank_ifsc, s.bank_beneficiary_name, s.upi_id, s.upi_qr_url
    INTO NEW.bank_name, NEW.bank_account_no, NEW.bank_ifsc, NEW.bank_beneficiary_name, NEW.upi_id, NEW.upi_qr_url
  FROM quotation_settings s WHERE s.account_id = NEW.account_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoices_snapshot_bank ON invoices;
CREATE TRIGGER trg_invoices_snapshot_bank BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_snapshot_bank();

CREATE OR REPLACE FUNCTION public.guard_bank_details()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.bank_name, NEW.bank_account_no, NEW.bank_ifsc, NEW.bank_beneficiary_name, NEW.upi_id, NEW.upi_qr_url)
         IS DISTINCT FROM
         (OLD.bank_name, OLD.bank_account_no, OLD.bank_ifsc, OLD.bank_beneficiary_name, OLD.upi_id, OLD.upi_qr_url)
     AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = NEW.account_id AND a.owner_user_id = auth.uid())
  THEN
    RAISE EXCEPTION 'Only the account owner can change bank or UPI details';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quotation_settings_bank_guard ON quotation_settings;
CREATE TRIGGER trg_quotation_settings_bank_guard BEFORE UPDATE ON quotation_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_details();

DROP TRIGGER IF EXISTS trg_invoices_bank_guard ON invoices;
CREATE TRIGGER trg_invoices_bank_guard BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_details();

-- 4. KPI progress: account check, deals_won fix, permission hardening
CREATE OR REPLACE FUNCTION public.kpi_progress(
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
  IF auth.uid() IS NOT NULL AND NOT is_account_member(p_account_id) THEN
    RAISE EXCEPTION 'Not a member of this account';
  END IF;

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
            AND d.assigned_to IN (SELECT pr.id FROM profiles pr WHERE pr.user_id = t.user_id)
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

REVOKE ALL ON FUNCTION public.kpi_progress(UUID, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kpi_progress(UUID, DATE, TEXT) TO authenticated, service_role;
