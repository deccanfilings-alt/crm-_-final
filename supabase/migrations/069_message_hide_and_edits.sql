-- ============================================================
-- 069_message_hide_and_edits.sql
--
-- Inbox message actions that work within WhatsApp Cloud API limits:
--
--   1. "Delete for me" — hides a message from the team inbox only.
--      The client still has it on WhatsApp (the Cloud API cannot
--      unsend). The row is kept for audit; admins still see it,
--      marked as hidden.
--
--   2. "Send correction" — the Cloud API cannot edit a sent message,
--      so the correction goes out as a new message quoting the
--      original. The correction points at the original, and the
--      original records when it was corrected.
--
--   3. Client-side edits / deletes — Meta's `edit` and `revoke`
--      webhooks (delivered to numbers in Coexistence mode). We keep
--      the first version of an edited message for reference, and
--      flag revoked messages instead of erasing them.
--
-- Idempotent — safe to run more than once.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hidden_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_of_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_content_text TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

COMMENT ON COLUMN messages.hidden_at IS 'Set when a team member chose "Delete for me". Hidden from agents in the inbox; the client still has the message.';
COMMENT ON COLUMN messages.hidden_by IS 'auth.users id of the team member who hid the message.';
COMMENT ON COLUMN messages.correction_of_message_id IS 'On a correction message: the original agent message it corrects.';
COMMENT ON COLUMN messages.corrected_at IS 'On an original message: when a correction was sent for it.';
COMMENT ON COLUMN messages.edited_at IS 'When the client edited this message (Meta edit webhook).';
COMMENT ON COLUMN messages.original_content_text IS 'The first version of a message the client later edited.';
COMMENT ON COLUMN messages.revoked_at IS 'When the client deleted this message for everyone (Meta revoke webhook).';

CREATE INDEX IF NOT EXISTS idx_messages_correction_of
  ON messages(correction_of_message_id)
  WHERE correction_of_message_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
