-- Migration 048: Add error_details JSONB to messages table to persist diagnostic info for failed messages
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS error_details JSONB;

COMMENT ON COLUMN messages.error_details IS 'Structured error details from Meta WhatsApp Cloud API or CRM sending failures (code, title, message, details, fbtrace_id)';
