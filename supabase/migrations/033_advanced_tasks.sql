-- 033_advanced_tasks.sql

-- Expand the status column to support Kanban stages. 
-- Existing 'pending' becomes 'todo'.
UPDATE public.action_items SET status = 'todo' WHERE status = 'pending';

-- Add new columns
ALTER TABLE public.action_items 
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal', -- low, normal, high, urgent
ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL;

-- If a task was created before assignee_id existed, assign it to the creator (agent_id)
UPDATE public.action_items SET assignee_id = agent_id WHERE assignee_id IS NULL;

-- Now make it NOT NULL so all tasks have an assignee
ALTER TABLE public.action_items ALTER COLUMN assignee_id SET NOT NULL;

-- Update RLS to allow agents to see tasks assigned to them, not just created by them
DROP POLICY IF EXISTS "Agents can manage their own action items" ON public.action_items;

CREATE POLICY "Agents can manage their assigned or created action items"
  ON public.action_items
  FOR ALL
  USING (
    account_id = (SELECT account_id FROM public.profiles WHERE user_id = auth.uid())
    AND (agent_id = auth.uid() OR assignee_id = auth.uid())
  );
