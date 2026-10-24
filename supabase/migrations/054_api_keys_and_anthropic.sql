-- ============================================================
-- 054_api_keys_and_anthropic.sql
-- Adds API Keys table for external Agentic Connectors (Claude Code,
-- OpenAI Codex, Cursor, AutoGen, etc.) and enables Anthropic as
-- a native AI provider.
-- ============================================================

-- 1. Create api_keys table
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{all}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for lightning fast key lookup and account scoping
CREATE INDEX IF NOT EXISTS idx_api_keys_account_id ON public.api_keys(account_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON public.api_keys(key_hash);

-- Enable RLS
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and Owners can manage API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Team members can manage API keys" ON public.api_keys;
CREATE POLICY "Team members can manage API keys"
  ON public.api_keys
  FOR ALL
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS set_api_keys_updated_at ON public.api_keys;
CREATE TRIGGER set_api_keys_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Update ai_providers check constraint to support 'anthropic' natively
ALTER TABLE public.ai_providers DROP CONSTRAINT IF EXISTS ai_providers_provider_check;
ALTER TABLE public.ai_providers ADD CONSTRAINT ai_providers_provider_check
  CHECK (provider IN ('openai', 'openrouter', 'sarvam', 'cohere', 'anthropic'));
