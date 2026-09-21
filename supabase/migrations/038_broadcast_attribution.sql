-- Migration 038: Broadcast to Pipeline Attribution Engine
-- Tracks which broadcast campaign generated a specific deal.

-- 1. Add last_broadcast_id to contacts (so we know the last campaign they received)
ALTER TABLE contacts
ADD COLUMN IF NOT EXISTS last_broadcast_id UUID REFERENCES broadcasts(id) ON DELETE SET NULL;

-- 2. Add broadcast_id to deals (so we can attribute revenue to a campaign)
ALTER TABLE deals
ADD COLUMN IF NOT EXISTS broadcast_id UUID REFERENCES broadcasts(id) ON DELETE SET NULL;

-- 3. Create an index for faster lookup on broadcast analytics page
CREATE INDEX IF NOT EXISTS idx_deals_broadcast_id ON deals(broadcast_id);
