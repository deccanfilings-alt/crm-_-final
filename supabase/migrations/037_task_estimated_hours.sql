-- 037_task_estimated_hours.sql
-- Moves estimated_hours from user_targets down to individual action_items

ALTER TABLE public.action_items 
ADD COLUMN IF NOT EXISTS estimated_hours numeric;

-- Optional: We can drop estimated_hours from user_targets, but we can also just leave it or drop it.
-- Let's drop it to keep things clean.
ALTER TABLE IF EXISTS public.user_targets
DROP COLUMN IF EXISTS estimated_hours;
