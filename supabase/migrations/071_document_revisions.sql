-- ============================================================
-- 071_document_revisions.sql
--
-- Editing quotations, proforma invoices and tax invoices after
-- they were sent (client asked for changes).
--
--   - `revision` counts edits made after the document was first sent
--     (0 = never revised). Shown as "Rev 2" in the CRM.
--   - `document_revisions` keeps a snapshot of the document as it was
--     BEFORE each edit (header + line items), with who changed it and
--     when — an audit trail, important for GST tax invoices.
--
-- The app works without this migration (edits still save); it simply
-- won't record revision numbers/history until it is applied.
-- Idempotent — safe to run more than once.
-- ============================================================

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revised_at TIMESTAMPTZ;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revised_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS document_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('quotation', 'proforma', 'tax_invoice')),
  document_id UUID NOT NULL,
  -- Revision number of the snapshot (the version that was replaced).
  revision INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  edited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_revisions_doc
  ON document_revisions(document_id, created_at DESC);

ALTER TABLE document_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_revisions_select ON document_revisions;
CREATE POLICY document_revisions_select ON document_revisions FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS document_revisions_insert ON document_revisions;
CREATE POLICY document_revisions_insert ON document_revisions FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
-- No update/delete policies: history is append-only.

NOTIFY pgrst, 'reload schema';
