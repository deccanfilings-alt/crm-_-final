-- 031_canned_responses_and_csat.sql

-- 1. Canned Responses
CREATE TABLE public.canned_responses (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  shortcut text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast lookup by account
CREATE INDEX idx_canned_responses_account ON public.canned_responses(account_id);

-- Enforce shortcut uniqueness per account
ALTER TABLE public.canned_responses ADD CONSTRAINT unique_shortcut_per_account UNIQUE(account_id, shortcut);

-- RLS
ALTER TABLE public.canned_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can view canned responses" 
  ON public.canned_responses FOR SELECT 
  USING (is_account_member(account_id, 'viewer'));

CREATE POLICY "Admins can insert canned responses" 
  ON public.canned_responses FOR INSERT 
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY "Admins can update canned responses" 
  ON public.canned_responses FOR UPDATE 
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY "Admins can delete canned responses" 
  ON public.canned_responses FOR DELETE 
  USING (is_account_member(account_id, 'admin'));

-- 2. CSAT Score on Conversations
ALTER TABLE public.conversations 
ADD COLUMN csat_score integer NULL CHECK (csat_score >= 1 AND csat_score <= 5),
ADD COLUMN csat_comment text NULL;
