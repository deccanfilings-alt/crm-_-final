-- Migration 052: SLA Breach Tracking on Conversations
-- Adds fields to conversations table to track customer response SLAs and breach events

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sla_threshold_minutes INTEGER DEFAULT 30;

-- Backfill last_customer_message_at from messages table for existing conversations if empty
UPDATE conversations c
SET last_customer_message_at = m.created_at
FROM (
  SELECT conversation_id, MAX(created_at) as created_at
  FROM messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE c.id = m.conversation_id
  AND c.last_customer_message_at IS NULL;

-- Index for high performance SLA sweeps
CREATE INDEX IF NOT EXISTS idx_conversations_sla ON conversations (account_id, status, last_customer_message_at)
  WHERE status = 'open';
