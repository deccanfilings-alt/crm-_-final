-- 062_task_recurrences.sql
-- Table: task_recurrences
CREATE TABLE IF NOT EXISTS task_recurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assignee_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_by UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  day_of_month INTEGER CHECK (day_of_month BETWEEN 1 AND 31),
  weekday INTEGER CHECK (weekday BETWEEN 0 AND 6),
  lead_days INTEGER NOT NULL DEFAULT 3 CHECK (lead_days >= 0),
  next_due_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  last_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_recurrences_account ON task_recurrences(account_id, active, next_due_date);
CREATE INDEX IF NOT EXISTS idx_task_recurrences_contact ON task_recurrences(contact_id);

ALTER TABLE task_recurrences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'task_recurrences' AND policyname = 'task_recurrences_account_member_select'
  ) THEN
    CREATE POLICY task_recurrences_account_member_select ON task_recurrences
      FOR SELECT USING (
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'task_recurrences' AND policyname = 'task_recurrences_insert'
  ) THEN
    CREATE POLICY task_recurrences_insert ON task_recurrences
      FOR INSERT WITH CHECK (
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'task_recurrences' AND policyname = 'task_recurrences_update'
  ) THEN
    CREATE POLICY task_recurrences_update ON task_recurrences
      FOR UPDATE USING (
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'task_recurrences' AND policyname = 'task_recurrences_delete'
  ) THEN
    CREATE POLICY task_recurrences_delete ON task_recurrences
      FOR DELETE USING (
        account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
      );
  END IF;
END $$;
