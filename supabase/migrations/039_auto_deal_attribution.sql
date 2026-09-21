-- Migration 039: Auto-Attribute Deals to Last Broadcast
-- Automatically tags a deal with the contact's last_broadcast_id if it's missing.

CREATE OR REPLACE FUNCTION set_deal_broadcast_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.broadcast_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    NEW.broadcast_id := (SELECT last_broadcast_id FROM contacts WHERE id = NEW.contact_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_deal_broadcast_id ON deals;

CREATE TRIGGER trg_set_deal_broadcast_id
BEFORE INSERT ON deals
FOR EACH ROW
EXECUTE FUNCTION set_deal_broadcast_id();
