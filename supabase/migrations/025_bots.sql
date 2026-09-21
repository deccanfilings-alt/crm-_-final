CREATE TABLE IF NOT EXISTS bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view bots in their account" ON bots FOR SELECT USING (is_account_member(account_id, 'viewer'));
CREATE POLICY "Users can insert bots in their account" ON bots FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY "Users can update bots in their account" ON bots FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY "Users can delete bots in their account" ON bots FOR DELETE USING (is_account_member(account_id, 'agent'));

CREATE TABLE IF NOT EXISTS bot_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  position_x INTEGER NOT NULL DEFAULT 0,
  position_y INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bot_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view bot_nodes in their account" ON bot_nodes FOR SELECT USING (bot_id IN (SELECT id FROM bots WHERE is_account_member(account_id, 'viewer')));
CREATE POLICY "Users can insert bot_nodes in their account" ON bot_nodes FOR INSERT WITH CHECK (bot_id IN (SELECT id FROM bots WHERE is_account_member(account_id, 'agent')));
CREATE POLICY "Users can update bot_nodes in their account" ON bot_nodes FOR UPDATE USING (bot_id IN (SELECT id FROM bots WHERE is_account_member(account_id, 'agent')));
CREATE POLICY "Users can delete bot_nodes in their account" ON bot_nodes FOR DELETE USING (bot_id IN (SELECT id FROM bots WHERE is_account_member(account_id, 'agent')));

CREATE TABLE IF NOT EXISTS bot_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  source_node_id UUID NOT NULL REFERENCES bot_nodes(id) ON DELETE CASCADE,
  target_node_id UUID NOT NULL REFERENCES bot_nodes(id) ON DELETE CASCADE,
  source_handle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bot_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view bot_edges in their account" ON bot_edges FOR SELECT USING (bot_id IN (SELECT id FROM bots WHERE is_account_member(account_id, 'viewer')));
CREATE POLICY "Users can insert bot_edges in their account" ON bot_edges FOR INSERT WITH CHECK (bot_id IN (SELECT id FROM bots WHERE is_account_member(account_id, 'agent')));
CREATE POLICY "Users can update bot_edges in their account" ON bot_edges FOR UPDATE USING (bot_id IN (SELECT id FROM bots WHERE is_account_member(account_id, 'agent')));
CREATE POLICY "Users can delete bot_edges in their account" ON bot_edges FOR DELETE USING (bot_id IN (SELECT id FROM bots WHERE is_account_member(account_id, 'agent')));

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS active_bot_id UUID REFERENCES bots(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS current_bot_node_id UUID REFERENCES bot_nodes(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_status TEXT NOT NULL DEFAULT 'inactive' CHECK (bot_status IN ('inactive', 'active', 'paused'));
