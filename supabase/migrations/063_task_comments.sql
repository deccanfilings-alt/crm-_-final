-- 063_task_comments.sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-files', 'task-files', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'task_files_authenticated_select'
  ) THEN
    CREATE POLICY task_files_authenticated_select ON storage.objects
      FOR SELECT TO authenticated USING (bucket_id = 'task-files');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname = 'task_files_authenticated_insert'
  ) THEN
    CREATE POLICY task_files_authenticated_insert ON storage.objects
      FOR INSERT TO authenticated WITH CHECK (bucket_id = 'task-files');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id UUID NOT NULL REFERENCES action_items(id) ON DELETE CASCADE,
  author_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  attachments JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(action_item_id, created_at ASC);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'task_comments' AND policyname = 'task_comments_account_member_select'
  ) THEN
    CREATE POLICY task_comments_account_member_select ON task_comments
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM action_items a
          WHERE a.id = task_comments.action_item_id
            AND a.account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'task_comments' AND policyname = 'task_comments_insert'
  ) THEN
    CREATE POLICY task_comments_insert ON task_comments
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM action_items a
          WHERE a.id = task_comments.action_item_id
            AND a.account_id = (SELECT account_id FROM profiles WHERE id = auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'task_comments' AND policyname = 'task_comments_delete'
  ) THEN
    CREATE POLICY task_comments_delete ON task_comments
      FOR DELETE USING (
        author_id = (SELECT user_id FROM profiles WHERE id = auth.uid())
        OR EXISTS (
          SELECT 1 FROM profiles
          WHERE id = auth.uid() AND account_role IN ('admin', 'owner')
        )
      );
  END IF;
END $$;
