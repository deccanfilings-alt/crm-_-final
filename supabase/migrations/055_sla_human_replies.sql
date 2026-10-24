-- Track the last time a PERSON replied. Inbox sends are sender_type 'agent';
-- flows and automations are 'bot'; internal notes are not replies.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_agent_message_at TIMESTAMPTZ;

UPDATE conversations c
SET last_agent_message_at = m.max_at
FROM (  SELECT conversation_id, MAX(created_at) AS max_at
  FROM messages
  WHERE sender_type = 'agent' AND COALESCE(is_internal, false) = false
  GROUP BY conversation_id
) m
WHERE c.id = m.conversation_id
  AND c.last_agent_message_at IS NULL;

CREATE OR REPLACE FUNCTION public.set_last_agent_message_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversations
    SET last_agent_message_at =
           GREATEST(COALESCE(last_agent_message_at, NEW.created_at), NEW.created_at)
   WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_last_agent_message_at ON messages;
CREATE TRIGGER trg_messages_last_agent_message_at
AFTER INSERT ON messages
FOR EACH ROW
WHEN (NEW.sender_type = 'agent' AND COALESCE(NEW.is_internal, false) = false)
EXECUTE FUNCTION public.set_last_agent_message_at();

-- The sweep now covers pending threads too (the old index was WHERE status = 'open').
DROP INDEX IF EXISTS idx_conversations_sla;
CREATE INDEX IF NOT EXISTS idx_conversations_sla
  ON conversations (account_id, status, last_customer_message_at)
  WHERE status IN ('open', 'pending');
