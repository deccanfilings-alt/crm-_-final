-- ============================================================
-- 036_user_targets.sql — Weekly and Quarterly Targets/Plans
--
-- 1. Creates `user_targets` table for setting weekly/quarterly goals.
-- 2. Adds `target_id` column to `action_items` to link tasks to goals.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_targets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  period_type text not null check (period_type in ('weekly', 'quarterly')),
  period_start_date date not null,
  title text not null,
  description text,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed')),
  estimated_hours numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_user_targets_account_user ON public.user_targets(account_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_targets_period ON public.user_targets(period_type, period_start_date);

-- Enable RLS
ALTER TABLE public.user_targets ENABLE ROW LEVEL SECURITY;

-- Agents can manage their own targets
DROP POLICY IF EXISTS "Agents can manage their own targets" ON public.user_targets;
CREATE POLICY "Agents can manage their own targets"
  ON public.user_targets
  FOR ALL
  USING (
    account_id = (SELECT account_id FROM public.profiles WHERE user_id = auth.uid())
    AND user_id = auth.uid()
  );

-- Admins and Owners can view all targets in the account
DROP POLICY IF EXISTS "Admins and Owners can view all targets in account" ON public.user_targets;
CREATE POLICY "Admins and Owners can view all targets in account"
  ON public.user_targets
  FOR SELECT
  USING (
    account_id = (SELECT account_id FROM public.profiles WHERE user_id = auth.uid())
    AND (
      (SELECT account_role FROM public.profiles WHERE user_id = auth.uid()) IN ('admin', 'owner')
    )
  );

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS set_user_targets_updated_at ON public.user_targets;
CREATE TRIGGER set_user_targets_updated_at
BEFORE UPDATE ON public.user_targets
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Link action items to targets
ALTER TABLE public.action_items 
ADD COLUMN IF NOT EXISTS target_id uuid references public.user_targets(id) on delete set null;

CREATE INDEX IF NOT EXISTS idx_action_items_target_id ON public.action_items(target_id);
