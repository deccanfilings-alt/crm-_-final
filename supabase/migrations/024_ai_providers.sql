CREATE TABLE IF NOT EXISTS ai_providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'openrouter', 'sarvam')),
  api_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_providers_account_provider ON ai_providers(account_id, provider);
CREATE INDEX IF NOT EXISTS idx_ai_providers_account ON ai_providers(account_id);

ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON ai_providers;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ai_providers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS ai_providers_select ON ai_providers;
CREATE POLICY ai_providers_select ON ai_providers FOR SELECT USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_providers_modify ON ai_providers;
CREATE POLICY ai_providers_modify ON ai_providers FOR ALL USING (is_account_member(account_id, 'admin')) WITH CHECK (is_account_member(account_id, 'admin'));
