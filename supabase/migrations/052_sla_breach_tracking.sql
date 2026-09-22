-- Migration 052: SLA Breach Tracking on Conversations
-- Adds fields to conversations table to track SLA thresholds and breach events

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS sla_threshold_minutes INTEGER DEFAULT 30;

CREATE INDEX IF NOT EXISTS idx_conversations_sla ON conversations (account_id, status, last_customer_message_at)
  WHERE status = 'open';
