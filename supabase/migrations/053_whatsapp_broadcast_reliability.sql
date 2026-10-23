-- Migration 053: WhatsApp Broadcast Reliability & Error Tracking Infrastructure

-- 0. Update check constraints to allow new status values ('halted', 'interrupted', 'paused', 'quarantined', 'retrying', 'defer')
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE broadcasts ADD CONSTRAINT broadcasts_status_check 
  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'completed', 'halted', 'interrupted', 'paused'));

ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS broadcast_recipients_status_check;
ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_recipients_status_check 
  CHECK (status IN ('pending', 'queued', 'sending', 'sent', 'delivered', 'read', 'replied', 'failed', 'quarantined', 'retrying', 'defer'));

-- 1. Add heartbeat and halt tracking to broadcasts table
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS halted_reason TEXT,
  ADD COLUMN IF NOT EXISTS halted_code INTEGER;

COMMENT ON COLUMN broadcasts.heartbeat_at IS 'Timestamp updated periodically by the sending loop to detect dead/stuck broadcast processes';
COMMENT ON COLUMN broadcasts.halted_reason IS 'Reason text when broadcast is halted due to template/account level error (circuit breaker)';
COMMENT ON COLUMN broadcasts.halted_code IS 'Meta error code that triggered the broadcast halt';

-- 2. Add attempt tracking, detailed error fields, and raw payloads to broadcast_recipients
ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disposition TEXT,
  ADD COLUMN IF NOT EXISTS error_code INTEGER,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS error_details TEXT,
  ADD COLUMN IF NOT EXISTS error_href TEXT,
  ADD COLUMN IF NOT EXISTS raw_response JSONB,
  ADD COLUMN IF NOT EXISTS raw_webhook_payload JSONB;

-- Index for retry and status queries
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_disposition ON broadcast_recipients(broadcast_id, disposition);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_next_attempt ON broadcast_recipients(status, next_attempt_at);

-- 3. Add opted_out_marketing column to contacts table for marketing opt-out tracking
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_out_marketing BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN contacts.opted_out_marketing IS 'Set to TRUE when customer opts out of marketing templates (via STOP/UNSUBSCRIBE or user_preferences webhook)';

-- 4. Clean up any historical stuck broadcasts (e.g. stuck in sending without heartbeat)
UPDATE broadcasts
SET status = 'interrupted',
    halted_reason = 'Broadcast sending process interrupted or lost heartbeat (reaper cleanup)'
WHERE status = 'sending'
  AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '15 minutes');
