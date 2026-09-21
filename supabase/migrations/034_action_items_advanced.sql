-- ============================================================
-- Advanced Action Items Extensions
-- Adds contact linkage, deal linkage, and subtasks (checklists)
-- ============================================================

ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subtasks JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_action_items_contact_id ON action_items(contact_id);
CREATE INDEX IF NOT EXISTS idx_action_items_deal_id ON action_items(deal_id);
