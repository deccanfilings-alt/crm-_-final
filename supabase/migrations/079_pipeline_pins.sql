-- 079: Per-user pinned pipelines.
--
-- Pipelines are shared by everyone in an account; pins are personal.
-- Each row says "this user pinned this pipeline". Pins are private:
-- a user only ever sees and changes their own. A pin disappears when
-- its pipeline (or the user) is deleted.
--
-- Safe to re-run: every statement is idempotent.

CREATE TABLE IF NOT EXISTS public.pipeline_pins (
  user_id     UUID NOT NULL DEFAULT auth.uid()
              REFERENCES auth.users(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL
              REFERENCES public.pipelines(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pipeline_id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_pins_pipeline
  ON public.pipeline_pins(pipeline_id);

ALTER TABLE public.pipeline_pins ENABLE ROW LEVEL SECURITY;

-- Read and remove: own pins only.
DROP POLICY IF EXISTS pipeline_pins_select ON public.pipeline_pins;
CREATE POLICY pipeline_pins_select ON public.pipeline_pins
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS pipeline_pins_delete ON public.pipeline_pins;
CREATE POLICY pipeline_pins_delete ON public.pipeline_pins
  FOR DELETE USING (user_id = auth.uid());

-- Add: own pins, and only on a pipeline in an account the user belongs
-- to (any role, viewers included: pinning changes nothing shared).
DROP POLICY IF EXISTS pipeline_pins_insert ON public.pipeline_pins;
CREATE POLICY pipeline_pins_insert ON public.pipeline_pins
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.pipelines p
      WHERE p.id = pipeline_id
        AND is_account_member(p.account_id)
    )
  );

-- No UPDATE policy: a pin is added or removed, never edited.
GRANT SELECT, INSERT, DELETE ON public.pipeline_pins TO authenticated;
