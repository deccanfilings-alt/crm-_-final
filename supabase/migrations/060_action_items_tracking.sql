-- Migration 060: Action Items Accountability, Permissions, and Tracking
-- Idempotent schema upgrades for task accountability

-- ============================================================
-- §1. New columns
-- ============================================================
ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,            -- optional exact time; target_date stays the day
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'; -- manual | team_chat | automation | mcp | recurring

-- Normalise, then constrain status and priority
UPDATE action_items SET status = 'todo' WHERE status NOT IN ('todo', 'in_progress', 'review', 'completed', 'cancelled');
UPDATE action_items SET priority = 'normal' WHERE priority NOT IN ('low', 'normal', 'high', 'urgent');
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_items_status_check') THEN
    ALTER TABLE action_items ADD CONSTRAINT action_items_status_check
      CHECK (status IN ('todo', 'in_progress', 'review', 'completed', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_items_priority_check') THEN
    ALTER TABLE action_items ADD CONSTRAINT action_items_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END $$;

-- Best available guess for old completed tasks
UPDATE action_items SET completed_at = updated_at WHERE status = 'completed' AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_assignee_status ON action_items(assignee_id, status, target_date);

-- Team for each member (used by the dashboard and escalation)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS team TEXT;   -- e.g. 'registrations', 'accounting'

-- ============================================================
-- §2. Completion/cancel timestamps, protected fields, history
-- ============================================================
CREATE OR REPLACE FUNCTION public.action_items_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- completed_at / cancelled_at follow status
  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed' THEN
      NEW.completed_at := COALESCE(NEW.completed_at, NOW());
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;

  IF NEW.status = 'cancelled' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, NOW());
    END IF;
  ELSE
    NEW.cancelled_at := NULL;
    NEW.cancel_reason := NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Never change after creation
    NEW.account_id := OLD.account_id;
    NEW.agent_id   := OLD.agent_id;
    NEW.created_at := OLD.created_at;
    NEW.source     := OLD.source;

    -- Assignee-only users (not creator, not admin) may change only status, description, subtasks, hours.
    -- auth.uid() is NULL for service-role writers (cron, MCP), which are trusted.
    IF auth.uid() IS NOT NULL
       AND auth.uid() <> OLD.agent_id
       AND NOT is_account_member(OLD.account_id, 'admin')
       AND (NEW.title, NEW.assignee_id, NEW.target_date, NEW.due_at, NEW.priority,
            NEW.contact_id, NEW.deal_id, NEW.conversation_id, NEW.target_id)
           IS DISTINCT FROM
           (OLD.title, OLD.assignee_id, OLD.target_date, OLD.due_at, OLD.priority,
            OLD.contact_id, OLD.deal_id, OLD.conversation_id, OLD.target_id)
    THEN
      RAISE EXCEPTION 'Only the person who created this task or an admin can change it';
    END IF;

    IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
       AND auth.uid() IS NOT NULL
       AND auth.uid() <> OLD.agent_id
       AND NOT is_account_member(OLD.account_id, 'admin')
    THEN
      RAISE EXCEPTION 'Only the person who created this task or an admin can cancel it';
    END IF;

    -- Clear reminder/escalation markers when the deadline moves
    IF NEW.target_date IS DISTINCT FROM OLD.target_date OR NEW.due_at IS DISTINCT FROM OLD.due_at THEN
      NEW.reminded_at := NULL;
      NEW.escalated_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_action_items_before_write ON action_items;
CREATE TRIGGER trg_action_items_before_write
BEFORE INSERT OR UPDATE ON action_items
FOR EACH ROW EXECUTE FUNCTION public.action_items_before_write();

CREATE TABLE IF NOT EXISTS action_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id UUID NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  actor_id UUID,                  -- NULL = system (cron, automation, MCP)
  event TEXT NOT NULL,            -- created | status_changed | reassigned | due_changed | priority_changed | title_changed
  from_value TEXT,
  to_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_action_item_events_item ON action_item_events(action_item_id, created_at);
ALTER TABLE action_item_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS action_item_events_select ON action_item_events;
CREATE POLICY action_item_events_select ON action_item_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM action_items a WHERE a.id = action_item_events.action_item_id));

CREATE OR REPLACE FUNCTION public.action_items_log_events()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'created', NEW.assignee_id::text);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'status_changed', OLD.status,
            CASE WHEN NEW.status = 'cancelled' THEN 'cancelled: ' || COALESCE(NEW.cancel_reason, '') ELSE NEW.status END);
  END IF;
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'reassigned', OLD.assignee_id::text, NEW.assignee_id::text);
  END IF;
  IF NEW.target_date IS DISTINCT FROM OLD.target_date OR NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'due_changed',
            concat_ws(' ', OLD.target_date::text, OLD.due_at::text),
            concat_ws(' ', NEW.target_date::text, NEW.due_at::text));
  END IF;
  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'priority_changed', OLD.priority, NEW.priority);
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title THEN
    INSERT INTO action_item_events (action_item_id, account_id, actor_id, event, from_value, to_value)
    VALUES (NEW.id, NEW.account_id, v_actor, 'title_changed', OLD.title, NEW.title);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_action_items_log_events ON action_items;
CREATE TRIGGER trg_action_items_log_events
AFTER INSERT OR UPDATE ON action_items
FOR EACH ROW EXECUTE FUNCTION public.action_items_log_events();

-- ============================================================
-- §3. Row-level security
-- ============================================================
DROP POLICY IF EXISTS "Agents can manage their own action items" ON action_items;
DROP POLICY IF EXISTS "Agents can manage their assigned or created action items" ON action_items;
DROP POLICY IF EXISTS "Admins and Owners can view all action items in account" ON action_items;

DROP POLICY IF EXISTS action_items_select ON action_items;
CREATE POLICY action_items_select ON action_items FOR SELECT
  USING (is_account_member(account_id)
         AND (agent_id = auth.uid() OR assignee_id = auth.uid() OR is_account_member(account_id, 'admin')));

DROP POLICY IF EXISTS action_items_insert ON action_items;
CREATE POLICY action_items_insert ON action_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent')
              AND agent_id = auth.uid()
              AND EXISTS (SELECT 1 FROM profiles p
                          WHERE p.user_id = assignee_id AND p.account_id = action_items.account_id));

DROP POLICY IF EXISTS action_items_update ON action_items;
CREATE POLICY action_items_update ON action_items FOR UPDATE
  USING (is_account_member(account_id)
         AND (agent_id = auth.uid() OR assignee_id = auth.uid() OR is_account_member(account_id, 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p
                      WHERE p.user_id = assignee_id AND p.account_id = action_items.account_id));

DROP POLICY IF EXISTS action_items_delete ON action_items;
CREATE POLICY action_items_delete ON action_items FOR DELETE
  USING (is_account_member(account_id)
         AND (agent_id = auth.uid() OR is_account_member(account_id, 'admin')));
