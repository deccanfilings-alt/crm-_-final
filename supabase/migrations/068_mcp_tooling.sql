-- ============================================================
-- 068_mcp_tooling.sql
-- MCP Connector Extensions & Tooling Support
-- ============================================================

-- §1. MCP Tool Call Audit Logging & Rate Limiting
CREATE TABLE IF NOT EXISTS mcp_tool_calls (
  id BIGSERIAL PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tool TEXT NOT NULL,
  args JSONB,                       -- shortened
  target_id UUID,                   -- conversation, contact, task acted on
  ok BOOLEAN NOT NULL,
  error TEXT,
  sends INTEGER NOT NULL DEFAULT 0, -- client messages this call sent
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_account_time ON mcp_tool_calls(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_key_time ON mcp_tool_calls(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_target_time ON mcp_tool_calls(target_id, created_at DESC);

ALTER TABLE mcp_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mcp_tool_calls_admin_select ON mcp_tool_calls;
CREATE POLICY mcp_tool_calls_admin_select ON mcp_tool_calls FOR SELECT
  USING (is_account_member(account_id, 'admin'));
-- No insert, update or delete policies: only the service role writes, and nobody edits the log.
