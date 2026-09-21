-- 032_action_items.sql

CREATE TABLE public.action_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  agent_id uuid not null references public.profiles(user_id) on delete cascade,
  title text not null,
  status text not null default 'pending', -- 'pending' or 'completed'
  target_date date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for efficient filtering
CREATE INDEX idx_action_items_account_date ON public.action_items(account_id, target_date);
CREATE INDEX idx_action_items_agent_date ON public.action_items(agent_id, target_date);

-- Enable RLS
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;

-- Agents can only see and manage their own action items
CREATE POLICY "Agents can manage their own action items"
  ON public.action_items
  FOR ALL
  USING (
    account_id = (SELECT account_id FROM public.profiles WHERE user_id = auth.uid())
    AND agent_id = auth.uid()
  );

-- Admins/Owners can see all action items in their account
CREATE POLICY "Admins and Owners can view all action items in account"
  ON public.action_items
  FOR SELECT
  USING (
    account_id = (SELECT account_id FROM public.profiles WHERE user_id = auth.uid())
    AND (
      (SELECT account_role FROM public.profiles WHERE user_id = auth.uid()) IN ('admin', 'owner')
    )
  );

-- Trigger function to auto-update updated_at (if not already exists)
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER set_action_items_updated_at
BEFORE UPDATE ON public.action_items
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();
