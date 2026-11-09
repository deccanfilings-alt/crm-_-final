-- 066_fix_rls_policies_and_handle_new_user.sql
-- Fixes:
-- 1. Restore complete handle_new_user trigger function that creates account and profile rows
--    with valid account_id and account_role, preventing "Caller has no profile" errors.
-- 2. Fix RLS policies on task_comments, kpi_targets, and task_recurrences which incorrectly
--    compared `profiles.id = auth.uid()` instead of `profiles.user_id = auth.uid()`.

-- 1. Restore handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner')
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE auth.users
  SET email_confirmed_at = COALESCE(email_confirmed_at, NOW())
  WHERE id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed in handle_new_user for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- 2. Fix task_comments RLS policies
DROP POLICY IF EXISTS task_comments_account_member_select ON public.task_comments;
DROP POLICY IF EXISTS task_comments_insert ON public.task_comments;
DROP POLICY IF EXISTS task_comments_delete ON public.task_comments;
DROP POLICY IF EXISTS task_comments_update ON public.task_comments;

CREATE POLICY task_comments_account_member_select ON public.task_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM action_items a
      WHERE a.id = task_comments.action_item_id
        AND a.account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    )
  );

CREATE POLICY task_comments_insert ON public.task_comments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM action_items a
      WHERE a.id = task_comments.action_item_id
        AND a.account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    )
  );

CREATE POLICY task_comments_delete ON public.task_comments
  FOR DELETE USING (
    author_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE user_id = auth.uid() AND account_role IN ('admin', 'owner')
    )
  );

CREATE POLICY task_comments_update ON public.task_comments
  FOR UPDATE USING (
    author_id = auth.uid()
  ) WITH CHECK (
    author_id = auth.uid()
  );

-- 3. Fix kpi_targets RLS policies
DROP POLICY IF EXISTS kpi_targets_account_member_select ON public.kpi_targets;
DROP POLICY IF EXISTS kpi_targets_insert ON public.kpi_targets;
DROP POLICY IF EXISTS kpi_targets_update ON public.kpi_targets;
DROP POLICY IF EXISTS kpi_targets_delete ON public.kpi_targets;

CREATE POLICY kpi_targets_account_member_select ON public.kpi_targets
  FOR SELECT USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY kpi_targets_insert ON public.kpi_targets
  FOR INSERT WITH CHECK (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY kpi_targets_update ON public.kpi_targets
  FOR UPDATE USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY kpi_targets_delete ON public.kpi_targets
  FOR DELETE USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

-- 4. Fix task_recurrences RLS policies
DROP POLICY IF EXISTS task_recurrences_account_member_select ON public.task_recurrences;
DROP POLICY IF EXISTS task_recurrences_insert ON public.task_recurrences;
DROP POLICY IF EXISTS task_recurrences_update ON public.task_recurrences;
DROP POLICY IF EXISTS task_recurrences_delete ON public.task_recurrences;

CREATE POLICY task_recurrences_account_member_select ON public.task_recurrences
  FOR SELECT USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY task_recurrences_insert ON public.task_recurrences
  FOR INSERT WITH CHECK (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY task_recurrences_update ON public.task_recurrences
  FOR UPDATE USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY task_recurrences_delete ON public.task_recurrences
  FOR DELETE USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

