-- ============================================================
-- 077_billing_invoice_upgrade.sql
--
-- Billing module part 2: Proforma and Tax Invoices get everything
-- quotations got in 076. Upgrades the existing tables — no data lost.
--
--   * Series for 'proforma' and 'tax_invoice' (continuing DF-PI- /
--     DF-TI- numbers), used by every path that numbers an invoice
--     (form, convert, record payment, move back).
--   * invoices: firm / series, Billed From / Billed To snapshots,
--     CGST/SGST/IGST, ledger lines, round off, sent ticks, soft delete.
--   * invoice_items: particular, service, SAC, per-line discount,
--     GST rate, tax, line total, tasks.
--   * Defaults triggers so older code paths still produce complete
--     rows; existing invoices are backfilled.
--   * billing_save_invoice(): one-transaction save for the new form.
--   * revert_billing_document() (074) now copies the new fields and
--     ledger lines when it creates a proforma / quotation.
--
-- Idempotent — safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Series types + "number taken" check
-- ------------------------------------------------------------
ALTER TABLE billing_series DROP CONSTRAINT IF EXISTS billing_series_doc_type_check;
DO $$ BEGIN
  ALTER TABLE billing_series ADD CONSTRAINT billing_series_doc_type_check
    CHECK (doc_type IN ('quotation', 'proforma', 'tax_invoice', 'invoice', 'receipt'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION billing_number_taken(p_account UUID, p_doc_type TEXT, p_number TEXT, p_exclude UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_doc_type = 'quotation' THEN EXISTS (SELECT 1 FROM quotations WHERE account_id = p_account AND quote_number = p_number AND id IS DISTINCT FROM p_exclude)
    WHEN p_doc_type IN ('invoice', 'proforma', 'tax_invoice') THEN EXISTS (SELECT 1 FROM invoices WHERE account_id = p_account AND invoice_number = p_number AND id IS DISTINCT FROM p_exclude)
    ELSE FALSE
  END
$$;
REVOKE ALL ON FUNCTION billing_number_taken(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 2. New invoice columns, item columns, ledger lines
-- ------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES billing_firms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES billing_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS series_period_id UUID REFERENCES billing_series_periods(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS running_no INTEGER,
  ADD COLUMN IF NOT EXISTS billed_from JSONB,
  ADD COLUMN IF NOT EXISTS billed_to JSONB,
  ADD COLUMN IF NOT EXISTS place_of_supply TEXT,
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ledger_adjustments_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_off NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sent_whatsapp_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_email_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_invoices_account_date ON invoices(account_id, issue_date DESC);

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS particular_id UUID REFERENCES billing_particulars(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_name TEXT,
  ADD COLUMN IF NOT EXISTS sac_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_type TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS line_total NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS linked_task_ids UUID[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_discount_type_check CHECK (discount_type IN ('INR', 'PERCENT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS invoice_ledger_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  ledger_id UUID REFERENCES billing_ledgers(id) ON DELETE SET NULL,
  ledger_name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_ledger_lines ON invoice_ledger_lines(invoice_id, position);

ALTER TABLE invoice_ledger_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_ledger_lines_select ON invoice_ledger_lines;
CREATE POLICY invoice_ledger_lines_select ON invoice_ledger_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND is_account_member(i.account_id)));
DROP POLICY IF EXISTS invoice_ledger_lines_write ON invoice_ledger_lines;
CREATE POLICY invoice_ledger_lines_write ON invoice_ledger_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND is_account_member(i.account_id, 'agent')))
  WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND is_account_member(i.account_id, 'agent')));

-- ------------------------------------------------------------
-- 3. Default proforma + tax invoice series (continue current numbers)
-- ------------------------------------------------------------
DO $$
DECLARE
  f RECORD;
  k RECORD;
  v_series UUID;
  v_prefix TEXT;
  v_counter INT;
  v_max INT;
BEGIN
  FOR f IN
    SELECT bf.id AS firm_id, bf.account_id, qs.proforma_prefix, qs.next_proforma_number,
           qs.tax_invoice_prefix, qs.next_tax_invoice_number
      FROM billing_firms bf
      LEFT JOIN quotation_settings qs ON qs.account_id = bf.account_id
     WHERE bf.is_default
  LOOP
    FOR k IN SELECT * FROM (VALUES ('proforma', 'Proforma Invoice'), ('tax_invoice', 'Tax Invoice')) AS t(kind, label) LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM billing_series WHERE firm_id = f.firm_id AND doc_type = k.kind);
      IF k.kind = 'proforma' THEN
        v_prefix := COALESCE(NULLIF(TRIM(f.proforma_prefix), ''), 'DF-PI-');
        v_counter := COALESCE(f.next_proforma_number, 1001);
      ELSE
        v_prefix := COALESCE(NULLIF(TRIM(f.tax_invoice_prefix), ''), 'DF-TI-');
        v_counter := COALESCE(f.next_tax_invoice_number, 1001);
      END IF;
      SELECT MAX(SUBSTR(invoice_number, LENGTH(v_prefix) + 1)::INT) INTO v_max
        FROM invoices
       WHERE account_id = f.account_id AND invoice_type = k.kind
         AND LEFT(invoice_number, LENGTH(v_prefix)) = v_prefix
         AND SUBSTR(invoice_number, LENGTH(v_prefix) + 1) ~ '^[0-9]{1,9}$';
      INSERT INTO billing_series (account_id, firm_id, doc_type, name, is_default)
      VALUES (f.account_id, f.firm_id, k.kind, k.label, TRUE)
      RETURNING id INTO v_series;
      INSERT INTO billing_series_periods (series_id, position, prefix, suffix, starting_no, next_no)
      VALUES (v_series, 0, v_prefix, '', 1001, GREATEST(v_counter, COALESCE(v_max, 0) + 1));
    END LOOP;
  END LOOP;
END $$;

-- Every older path numbering an invoice now uses the default series.
CREATE OR REPLACE FUNCTION billing_next_number(p_account UUID, p_kind TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_counter INT;
  v_max INT;
  v_num INT;
  v_series UUID;
  v_doc TEXT := CASE p_kind WHEN 'quote' THEN 'quotation' ELSE p_kind END;
BEGIN
  IF p_kind NOT IN ('quote', 'proforma', 'tax_invoice') THEN
    RAISE EXCEPTION 'Unknown numbering kind %', p_kind USING ERRCODE = '22023';
  END IF;

  SELECT s.id INTO v_series
    FROM billing_series s JOIN billing_firms f ON f.id = s.firm_id
   WHERE s.account_id = p_account AND s.doc_type = v_doc AND s.is_default AND f.is_default
   LIMIT 1;
  IF v_series IS NOT NULL THEN
    RETURN billing_series_allocate(v_series, (NOW() AT TIME ZONE 'Asia/Kolkata')::date) ->> 'number';
  END IF;

  -- Fallback (no series yet): settings counter, self-healing.
  INSERT INTO quotation_settings (account_id) VALUES (p_account) ON CONFLICT (account_id) DO NOTHING;
  SELECT CASE p_kind WHEN 'quote' THEN quote_prefix WHEN 'proforma' THEN proforma_prefix ELSE tax_invoice_prefix END,
         CASE p_kind WHEN 'quote' THEN next_quote_number WHEN 'proforma' THEN next_proforma_number ELSE next_tax_invoice_number END
    INTO v_prefix, v_counter
    FROM quotation_settings WHERE account_id = p_account FOR UPDATE;
  v_prefix := COALESCE(NULLIF(TRIM(v_prefix), ''), CASE p_kind WHEN 'quote' THEN 'DF-QT-' WHEN 'proforma' THEN 'DF-PI-' ELSE 'DF-TI-' END);
  IF p_kind = 'quote' THEN
    SELECT MAX(SUBSTR(quote_number, LENGTH(v_prefix) + 1)::INT) INTO v_max FROM quotations
     WHERE account_id = p_account AND LEFT(quote_number, LENGTH(v_prefix)) = v_prefix
       AND SUBSTR(quote_number, LENGTH(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  ELSE
    SELECT MAX(SUBSTR(invoice_number, LENGTH(v_prefix) + 1)::INT) INTO v_max FROM invoices
     WHERE account_id = p_account AND invoice_type = p_kind AND LEFT(invoice_number, LENGTH(v_prefix)) = v_prefix
       AND SUBSTR(invoice_number, LENGTH(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  END IF;
  v_num := GREATEST(COALESCE(v_counter, 1001), COALESCE(v_max, 0) + 1, 1);
  IF p_kind = 'quote' THEN
    UPDATE quotation_settings SET next_quote_number = v_num + 1, updated_at = NOW() WHERE account_id = p_account;
  ELSIF p_kind = 'proforma' THEN
    UPDATE quotation_settings SET next_proforma_number = v_num + 1, updated_at = NOW() WHERE account_id = p_account;
  ELSE
    UPDATE quotation_settings SET next_tax_invoice_number = v_num + 1, updated_at = NOW() WHERE account_id = p_account;
  END IF;
  RETURN v_prefix || LPAD(v_num::TEXT, 4, '0');
END;
$$;
REVOKE ALL ON FUNCTION billing_next_number(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. Defaults: older code paths still produce complete rows
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoices_fill_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS NULL THEN
    SELECT id INTO NEW.firm_id FROM billing_firms WHERE account_id = NEW.account_id AND is_default LIMIT 1;
  END IF;
  IF NEW.series_id IS NULL AND NEW.firm_id IS NOT NULL THEN
    SELECT id INTO NEW.series_id FROM billing_series
     WHERE firm_id = NEW.firm_id AND doc_type = NEW.invoice_type AND is_default LIMIT 1;
  END IF;
  IF NEW.billed_from IS NULL THEN
    NEW.billed_from := jsonb_strip_nulls(jsonb_build_object(
      'name', NEW.company_name, 'address', NEW.company_address, 'phone', NEW.company_phone,
      'email', NEW.company_email, 'website', NEW.company_website, 'gstin', NEW.gstin, 'pan', NEW.pan,
      'logo_url', NEW.company_logo_url,
      'state', (SELECT state FROM billing_firms WHERE id = NEW.firm_id)));
  END IF;
  IF NEW.billed_to IS NULL THEN
    NEW.billed_to := jsonb_strip_nulls(jsonb_build_object(
      'name', COALESCE(NULLIF(NEW.client_company, ''), NEW.client_name),
      'contact_name', CASE WHEN NULLIF(NEW.client_company, '') IS NOT NULL THEN NEW.client_name END,
      'address', NEW.client_address, 'phone', NEW.client_phone, 'email', NEW.client_email, 'gstin', NEW.client_gstin));
  END IF;
  -- One tax line from older code: split it CGST + SGST.
  IF NEW.cgst_amount = 0 AND NEW.sgst_amount = 0 AND NEW.igst_amount = 0 AND COALESCE(NEW.tax_amount, 0) <> 0 THEN
    NEW.cgst_amount := ROUND(NEW.tax_amount / 2, 2);
    NEW.sgst_amount := NEW.tax_amount - NEW.cgst_amount;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_invoices_fill_defaults ON invoices;
CREATE TRIGGER trg_invoices_fill_defaults BEFORE INSERT ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_fill_defaults();

CREATE OR REPLACE FUNCTION invoice_items_fill_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.gst_rate := COALESCE(NEW.gst_rate, NEW.tax_rate, 0);
  NEW.taxable_amount := COALESCE(NEW.taxable_amount, NEW.total, ROUND(COALESCE(NEW.quantity, 1) * COALESCE(NEW.unit_price, 0), 2));
  NEW.tax_amount := COALESCE(NEW.tax_amount, ROUND(NEW.taxable_amount * NEW.gst_rate / 100, 2));
  NEW.line_total := COALESCE(NEW.line_total, NEW.taxable_amount + NEW.tax_amount);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_invoice_items_fill_defaults ON invoice_items;
CREATE TRIGGER trg_invoice_items_fill_defaults BEFORE INSERT ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_fill_defaults();

-- ------------------------------------------------------------
-- 5. Backfill existing invoices
-- ------------------------------------------------------------
UPDATE invoices i
   SET firm_id = COALESCE(i.firm_id, f.id),
       series_id = COALESCE(i.series_id, (SELECT s.id FROM billing_series s
                                            WHERE s.firm_id = f.id AND s.doc_type = i.invoice_type AND s.is_default LIMIT 1)),
       billed_from = COALESCE(i.billed_from, jsonb_strip_nulls(jsonb_build_object(
         'name', COALESCE(NULLIF(i.company_name, ''), f.name),
         'address', COALESCE(NULLIF(i.company_address, ''), f.address_line1),
         'phone', COALESCE(NULLIF(i.company_phone, ''), f.phone),
         'email', COALESCE(NULLIF(i.company_email, ''), f.email),
         'website', COALESCE(NULLIF(i.company_website, ''), f.website),
         'gstin', COALESCE(NULLIF(i.gstin, ''), f.gstin),
         'pan', COALESCE(NULLIF(i.pan, ''), f.pan),
         'state', f.state,
         'logo_url', COALESCE(NULLIF(i.company_logo_url, ''), f.logo_url)))),
       billed_to = COALESCE(i.billed_to, jsonb_strip_nulls(jsonb_build_object(
         'name', COALESCE(NULLIF(i.client_company, ''), i.client_name),
         'contact_name', CASE WHEN NULLIF(i.client_company, '') IS NOT NULL THEN i.client_name END,
         'address', i.client_address, 'phone', i.client_phone, 'email', i.client_email, 'gstin', i.client_gstin))),
       cgst_amount = CASE WHEN i.cgst_amount = 0 AND i.sgst_amount = 0 AND i.igst_amount = 0
                          THEN ROUND(COALESCE(i.tax_amount, 0) / 2, 2) ELSE i.cgst_amount END,
       sgst_amount = CASE WHEN i.cgst_amount = 0 AND i.sgst_amount = 0 AND i.igst_amount = 0
                          THEN COALESCE(i.tax_amount, 0) - ROUND(COALESCE(i.tax_amount, 0) / 2, 2) ELSE i.sgst_amount END
  FROM billing_firms f
 WHERE f.account_id = i.account_id AND f.is_default
   AND (i.firm_id IS NULL OR i.billed_from IS NULL);

UPDATE invoice_items it
   SET gst_rate = COALESCE(it.gst_rate, CASE WHEN inv.tax_type = 'none' THEN 0 ELSE COALESCE(it.tax_rate, inv.tax_rate, 0) END),
       taxable_amount = COALESCE(it.taxable_amount, it.total, 0)
  FROM invoices inv
 WHERE inv.id = it.invoice_id AND (it.gst_rate IS NULL OR it.taxable_amount IS NULL);
UPDATE invoice_items
   SET tax_amount = COALESCE(tax_amount, ROUND(taxable_amount * gst_rate / 100, 2)),
       line_total = COALESCE(line_total, taxable_amount + COALESCE(tax_amount, ROUND(taxable_amount * gst_rate / 100, 2)))
 WHERE tax_amount IS NULL OR line_total IS NULL;

-- ------------------------------------------------------------
-- 6. Save a proforma / tax invoice from the new form (one transaction)
--    p_doc carries computed totals (app engine). Payment amounts on
--    an existing invoice always come from the database, never the form.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_save_invoice(p_id UUID, p_doc JSONB, p_items JSONB, p_ledgers JSONB, p_running_no INTEGER DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_account UUID;
  v_inv invoices%ROWTYPE;
  v_type TEXT := p_doc->>'invoice_type';
  v_series UUID := NULLIF(p_doc->>'series_id', '')::UUID;
  v_date DATE := COALESCE(NULLIF(p_doc->>'issue_date', '')::DATE, (NOW() AT TIME ZONE 'Asia/Kolkata')::date);
  v_total NUMERIC := COALESCE((p_doc->>'total_amount')::NUMERIC, 0);
  v_paid NUMERIC;
  v_status TEXT;
  v_draft BOOLEAN := COALESCE((p_doc->>'draft')::BOOLEAN, FALSE);
  v_alloc JSON;
  v_number TEXT;
  v_period UUID;
  v_running INTEGER;
  v_id UUID;
  qs quotation_settings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_uid;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'You don''t have permission to save invoices' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one line item' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_inv FROM invoices WHERE id = p_id AND account_id = v_account AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_inv.status = 'cancelled' THEN
      RAISE EXCEPTION '% is cancelled and can''t be edited', v_inv.invoice_number USING ERRCODE = '22023';
    END IF;
    v_type := v_inv.invoice_type;  -- type never changes on edit
    v_paid := COALESCE(v_inv.paid_amount, 0);
    IF v_total + 0.005 < v_paid THEN
      RAISE EXCEPTION 'The new total (%) is less than the % already paid', v_total, v_paid USING ERRCODE = '22023';
    END IF;
    v_draft := v_draft AND v_inv.status = 'draft';
  ELSE
    IF v_type NOT IN ('proforma', 'tax_invoice') THEN
      RAISE EXCEPTION 'Pick Proforma or Tax Invoice' USING ERRCODE = '22023';
    END IF;
    v_paid := LEAST(GREATEST(COALESCE((p_doc->>'paid_amount')::NUMERIC, 0), 0), v_total);
  END IF;

  IF v_series IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM billing_series WHERE id = v_series AND account_id = v_account AND doc_type = v_type) THEN
    RAISE EXCEPTION 'Pick a % series', REPLACE(v_type, '_', ' ') USING ERRCODE = '22023';
  END IF;

  v_status := CASE
    WHEN v_draft THEN 'draft'
    WHEN v_total - v_paid <= 0.005 AND v_total > 0 THEN 'paid'
    WHEN v_paid > 0 THEN 'partially_paid'
    ELSE 'unpaid' END;

  IF v_series IS NOT NULL AND (
       p_id IS NULL
       OR (p_running_no IS NOT NULL AND p_running_no IS DISTINCT FROM v_inv.running_no)
       OR v_series IS DISTINCT FROM v_inv.series_id) THEN
    v_alloc := billing_series_allocate(v_series, v_date, p_running_no, p_id);
    v_number := v_alloc->>'number';
    v_period := (v_alloc->>'period_id')::UUID;
    v_running := (v_alloc->>'running_no')::INTEGER;
  ELSIF p_id IS NOT NULL THEN
    v_number := v_inv.invoice_number; v_period := v_inv.series_period_id; v_running := v_inv.running_no;
  ELSE
    v_number := billing_next_number(v_account, v_type);
  END IF;

  IF p_id IS NULL THEN
    SELECT * INTO qs FROM quotation_settings WHERE account_id = v_account;
    INSERT INTO invoices (account_id, invoice_type, invoice_number, title, client_name, created_by_user_id, status,
                          quotation_id, public_token,
                          bank_name, bank_account_no, bank_ifsc, bank_beneficiary_name, upi_id, upi_qr_url,
                          payment_method, payment_reference, paid_at)
    VALUES (v_account, v_type, v_number, COALESCE(NULLIF(p_doc->>'title', ''), 'Invoice'),
            COALESCE(NULLIF(p_doc->>'client_name', ''), 'Client'), v_uid, 'draft',
            NULLIF(p_doc->>'quotation_id', '')::UUID, REPLACE(gen_random_uuid()::TEXT, '-', ''),
            qs.bank_name, qs.bank_account_no, qs.bank_ifsc, qs.bank_beneficiary_name, qs.upi_id, qs.upi_qr_url,
            CASE WHEN v_paid > 0 THEN COALESCE(NULLIF(p_doc->>'payment_method', ''), 'upi') END,
            CASE WHEN v_paid > 0 THEN NULLIF(p_doc->>'payment_reference', '') END,
            CASE WHEN v_paid > 0 THEN COALESCE(NULLIF(p_doc->>'paid_at', '')::TIMESTAMPTZ, NOW()) END)
    RETURNING id INTO v_id;
  ELSE
    v_id := p_id;
  END IF;

  UPDATE invoices SET
    invoice_number = v_number,
    series_id = v_series,
    series_period_id = v_period,
    running_no = v_running,
    firm_id = COALESCE(NULLIF(p_doc->>'firm_id', '')::UUID, firm_id),
    status = v_status,
    title = COALESCE(NULLIF(p_doc->>'title', ''), 'Invoice'),
    issue_date = v_date,
    due_date = CASE WHEN v_status = 'paid' THEN NULL ELSE NULLIF(p_doc->>'due_date', '')::DATE END,
    contact_id = NULLIF(p_doc->>'contact_id', '')::UUID,
    deal_id = COALESCE(NULLIF(p_doc->>'deal_id', '')::UUID, deal_id),
    conversation_id = COALESCE(NULLIF(p_doc->>'conversation_id', '')::UUID, conversation_id),
    billed_from = p_doc->'billed_from',
    billed_to = p_doc->'billed_to',
    place_of_supply = NULLIF(p_doc->>'place_of_supply', ''),
    client_name = COALESCE(NULLIF(p_doc->>'client_name', ''), 'Client'),
    client_company = NULLIF(p_doc->>'client_company', ''),
    client_phone = NULLIF(p_doc->>'client_phone', ''),
    client_email = NULLIF(p_doc->>'client_email', ''),
    client_address = NULLIF(p_doc->>'client_address', ''),
    client_gstin = NULLIF(p_doc->>'client_gstin', ''),
    company_name = NULLIF(p_doc->'billed_from'->>'name', ''),
    company_address = NULLIF(p_doc->'billed_from'->>'address', ''),
    company_phone = NULLIF(p_doc->'billed_from'->>'phone', ''),
    company_email = NULLIF(p_doc->'billed_from'->>'email', ''),
    company_website = NULLIF(p_doc->'billed_from'->>'website', ''),
    company_logo_url = NULLIF(p_doc->'billed_from'->>'logo_url', ''),
    gstin = NULLIF(p_doc->'billed_from'->>'gstin', ''),
    pan = NULLIF(p_doc->'billed_from'->>'pan', ''),
    signature_url = NULLIF(p_doc->>'signature_url', ''),
    stamp_url = NULLIF(p_doc->>'stamp_url', ''),
    subtotal = COALESCE((p_doc->>'subtotal')::NUMERIC, 0),
    discount_type = CASE WHEN COALESCE((p_doc->>'discount_amount')::NUMERIC, 0) > 0 THEN 'fixed' ELSE 'none' END,
    discount_value = COALESCE((p_doc->>'discount_amount')::NUMERIC, 0),
    discount_amount = COALESCE((p_doc->>'discount_amount')::NUMERIC, 0),
    tax_type = COALESCE(NULLIF(p_doc->>'tax_type', ''), 'gst'),
    tax_rate = COALESCE((p_doc->>'tax_rate')::NUMERIC, 0),
    tax_amount = COALESCE((p_doc->>'tax_amount')::NUMERIC, 0),
    cgst_amount = COALESCE((p_doc->>'cgst_amount')::NUMERIC, 0),
    sgst_amount = COALESCE((p_doc->>'sgst_amount')::NUMERIC, 0),
    igst_amount = COALESCE((p_doc->>'igst_amount')::NUMERIC, 0),
    ledger_adjustments_total = COALESCE((p_doc->>'ledger_adjustments_total')::NUMERIC, 0),
    round_off = COALESCE((p_doc->>'round_off')::NUMERIC, 0),
    total_amount = v_total,
    paid_amount = v_paid,
    balance_amount = GREATEST(0, ROUND(v_total - v_paid, 2)),
    notes = NULLIF(p_doc->>'notes', ''),
    terms = NULLIF(p_doc->>'terms', ''),
    updated_at = NOW()
  WHERE id = v_id;

  DELETE FROM invoice_items WHERE invoice_id = v_id;
  INSERT INTO invoice_items (invoice_id, position, particular_id, title, description, service_name, sac_code,
                             quantity, unit_price, discount_value, discount_type, gst_rate, tax_rate,
                             taxable_amount, tax_amount, line_total, total, linked_task_ids)
  SELECT v_id, (e.ord - 1)::INT,
         NULLIF(e.it->>'particular_id', '')::UUID,
         COALESCE(NULLIF(TRIM(e.it->>'title'), ''), 'Item'),
         NULLIF(e.it->>'description', ''),
         NULLIF(e.it->>'service_name', ''),
         NULLIF(e.it->>'sac_code', ''),
         COALESCE((e.it->>'quantity')::NUMERIC, 1),
         COALESCE((e.it->>'unit_price')::NUMERIC, 0),
         COALESCE((e.it->>'discount_value')::NUMERIC, 0),
         CASE WHEN e.it->>'discount_type' = 'PERCENT' THEN 'PERCENT' ELSE 'INR' END,
         COALESCE((e.it->>'gst_rate')::NUMERIC, 0),
         COALESCE((e.it->>'gst_rate')::NUMERIC, 0),
         COALESCE((e.it->>'taxable_amount')::NUMERIC, 0),
         COALESCE((e.it->>'tax_amount')::NUMERIC, 0),
         COALESCE((e.it->>'line_total')::NUMERIC, 0),
         COALESCE((e.it->>'taxable_amount')::NUMERIC, 0),
         COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(e.it->'linked_task_ids', '[]'::JSONB))::UUID), '{}')
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(it, ord);

  DELETE FROM invoice_ledger_lines WHERE invoice_id = v_id;
  IF jsonb_typeof(p_ledgers) = 'array' THEN
    INSERT INTO invoice_ledger_lines (invoice_id, ledger_id, ledger_name, amount, position)
    SELECT v_id, NULLIF(e.l->>'ledger_id', '')::UUID, COALESCE(NULLIF(e.l->>'ledger_name', ''), 'Ledger'),
           COALESCE((e.l->>'amount')::NUMERIC, 0), (e.ord - 1)::INT
      FROM jsonb_array_elements(p_ledgers) WITH ORDINALITY AS e(l, ord);
  END IF;

  RETURN json_build_object('id', v_id, 'invoice_number', v_number, 'invoice_type', v_type, 'status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION billing_save_invoice(UUID, JSONB, JSONB, JSONB, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION billing_save_invoice(UUID, JSONB, JSONB, JSONB, INTEGER) TO authenticated;

-- ------------------------------------------------------------
-- 7. Copy a document's lines + ledger lines (used by move-back)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_copy_invoice_lines(p_from UUID, p_to UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO invoice_items (invoice_id, position, particular_id, title, description, service_name, sac_code, quantity,
                             unit_price, discount_value, discount_type, gst_rate, tax_rate, taxable_amount, tax_amount,
                             line_total, total, linked_task_ids)
  SELECT p_to, position, particular_id, title, description, service_name, sac_code, quantity, unit_price, discount_value,
         discount_type, gst_rate, tax_rate, taxable_amount, tax_amount, line_total, total, linked_task_ids
    FROM invoice_items WHERE invoice_id = p_from;
  INSERT INTO invoice_ledger_lines (invoice_id, ledger_id, ledger_name, amount, position)
  SELECT p_to, ledger_id, ledger_name, amount, position FROM invoice_ledger_lines WHERE invoice_id = p_from;
$$;
REVOKE ALL ON FUNCTION billing_copy_invoice_lines(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8. Move back (074) — same behaviour, now carrying the new fields,
--    line details and ledger lines into the proforma / quotation it
--    creates.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION revert_billing_document(p_invoice_id UUID, p_to TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_inv invoices%ROWTYPE;
  v_ti invoices%ROWTYPE;
  v_pi invoices%ROWTYPE;
  v_has_ti BOOLEAN := FALSE;
  v_has_pi BOOLEAN := FALSE;
  v_src invoices%ROWTYPE;
  v_reason TEXT := NULLIF(LEFT(TRIM(COALESCE(p_reason, '')), 500), '');
  v_now TIMESTAMPTZ := NOW();
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Kolkata')::date;
  v_cancelled TEXT[] := '{}';
  v_qid UUID;
  v_q quotations%ROWTYPE;
  v_new_id UUID;
  v_new_number TEXT;
  v_created BOOLEAN := FALSE;
  v_target_type TEXT;
  v_target_id UUID;
  v_target_number TEXT;
  v_payment_removed NUMERIC := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_to NOT IN ('quotation', 'proforma') THEN
    RAISE EXCEPTION 'You can move back to "quotation" or "proforma"' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT is_account_member(v_inv.account_id, 'agent') THEN
    RAISE EXCEPTION 'You don''t have permission to change invoices' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status = 'cancelled' THEN
    RAISE EXCEPTION '% is already cancelled', v_inv.invoice_number USING ERRCODE = '22023';
  END IF;
  IF p_to = 'proforma' AND v_inv.invoice_type <> 'tax_invoice' THEN
    RAISE EXCEPTION 'A proforma can only move back to the quotation stage' USING ERRCODE = '22023';
  END IF;

  IF v_inv.invoice_type = 'tax_invoice' THEN
    v_ti := v_inv; v_has_ti := TRUE;
    IF v_inv.source_invoice_id IS NOT NULL THEN
      SELECT * INTO v_pi FROM invoices WHERE id = v_inv.source_invoice_id AND status <> 'cancelled' FOR UPDATE;
      v_has_pi := FOUND;
    END IF;
  ELSE
    v_pi := v_inv; v_has_pi := TRUE;
    SELECT * INTO v_ti FROM invoices
     WHERE source_invoice_id = v_inv.id AND invoice_type = 'tax_invoice' AND status <> 'cancelled'
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    v_has_ti := FOUND;
  END IF;

  IF v_has_ti THEN
    UPDATE invoices SET status = 'cancelled', cancelled_at = v_now, cancelled_by = v_uid,
           cancel_reason = COALESCE(v_reason, 'Moved back to ' || p_to), updated_at = v_now
     WHERE id = v_ti.id;
    v_cancelled := v_cancelled || v_ti.invoice_number;
  END IF;

  IF p_to = 'proforma' THEN
    IF v_has_pi THEN
      v_payment_removed := COALESCE(v_pi.paid_amount, 0);
      UPDATE invoices
         SET status = 'unpaid', paid_amount = 0, balance_amount = total_amount,
             payment_method = NULL, payment_reference = NULL, payment_notes = NULL, paid_at = NULL, updated_at = v_now
       WHERE id = v_pi.id;
      v_target_id := v_pi.id; v_target_number := v_pi.invoice_number;
    ELSE
      v_new_number := billing_next_number(v_ti.account_id, 'proforma');
      INSERT INTO invoices (
        account_id, quotation_id, invoice_type, invoice_number, title, contact_id, deal_id, conversation_id,
        created_by_user_id, status, issue_date, due_date, currency,
        subtotal, discount_type, discount_value, discount_amount, tax_type, tax_rate, tax_amount, total_amount,
        paid_amount, balance_amount,
        client_name, client_phone, client_email, client_company, client_address, client_gstin,
        company_name, company_logo_url, company_address, company_phone, company_email, company_website,
        gstin, pan, signature_url, stamp_url,
        bank_name, bank_account_no, bank_ifsc, bank_beneficiary_name, upi_id, upi_qr_url,
        notes, terms, custom_message, public_token,
        firm_id, billed_from, billed_to, place_of_supply, cgst_amount, sgst_amount, igst_amount,
        ledger_adjustments_total, round_off
      )
      SELECT account_id, quotation_id, 'proforma', v_new_number,
             REGEXP_REPLACE(title, '^Tax Invoice', 'Proforma Invoice'), contact_id, deal_id, conversation_id,
             v_uid, 'unpaid', v_today, v_today + 7, currency,
             subtotal, discount_type, discount_value, discount_amount, tax_type, tax_rate, tax_amount, total_amount,
             0, total_amount,
             client_name, client_phone, client_email, client_company, client_address, client_gstin,
             company_name, company_logo_url, company_address, company_phone, company_email, company_website,
             gstin, pan, signature_url, stamp_url,
             bank_name, bank_account_no, bank_ifsc, bank_beneficiary_name, upi_id, upi_qr_url,
             notes, terms, custom_message, REPLACE(gen_random_uuid()::TEXT, '-', ''),
             firm_id, billed_from, billed_to, place_of_supply, cgst_amount, sgst_amount, igst_amount,
             ledger_adjustments_total, round_off
        FROM invoices WHERE id = v_ti.id
      RETURNING id INTO v_new_id;
      PERFORM billing_copy_invoice_lines(v_ti.id, v_new_id);
      UPDATE invoices SET source_invoice_id = v_new_id WHERE id = v_ti.id;
      v_payment_removed := COALESCE(v_ti.paid_amount, 0);
      v_created := TRUE;
      v_target_id := v_new_id; v_target_number := v_new_number;
    END IF;
    v_target_type := 'proforma';

  ELSE
    IF v_has_pi THEN
      UPDATE invoices SET status = 'cancelled', cancelled_at = v_now, cancelled_by = v_uid,
             cancel_reason = COALESCE(v_reason, 'Moved back to quotation'), updated_at = v_now
       WHERE id = v_pi.id;
      v_cancelled := v_cancelled || v_pi.invoice_number;
    END IF;
    v_payment_removed := GREATEST(COALESCE(CASE WHEN v_has_pi THEN v_pi.paid_amount END, 0),
                                  COALESCE(CASE WHEN v_has_ti THEN v_ti.paid_amount END, 0));

    v_qid := COALESCE(v_inv.quotation_id, CASE WHEN v_has_pi THEN v_pi.quotation_id END);
    IF v_qid IS NOT NULL THEN
      SELECT * INTO v_q FROM quotations WHERE id = v_qid AND account_id = v_inv.account_id AND deleted_at IS NULL FOR UPDATE;
    END IF;

    IF v_qid IS NOT NULL AND v_q.id IS NOT NULL THEN
      UPDATE quotations
         SET status = CASE WHEN finalized_at IS NOT NULL OR sent_at IS NOT NULL THEN 'final' ELSE 'draft' END,
             accepted_at = NULL, rejected_at = NULL, updated_at = v_now
       WHERE id = v_q.id;
      v_target_id := v_q.id; v_target_number := v_q.quote_number;
    ELSE
      IF v_has_pi THEN v_src := v_pi; ELSE v_src := v_ti; END IF;
      v_new_number := billing_next_number(v_src.account_id, 'quote');
      INSERT INTO quotations (
        account_id, quote_number, title, contact_id, deal_id, conversation_id, created_by_user_id,
        status, issue_date, valid_until, currency,
        subtotal, discount_type, discount_value, discount_amount, tax_type, tax_rate, tax_amount, total_amount,
        client_name, client_phone, client_email, client_company, client_address, client_gstin,
        notes, terms, company_name, company_logo_url, company_address, company_phone, company_email,
        company_website, gstin, pan, signature_url, stamp_url, custom_message, public_token,
        firm_id, billed_from, billed_to, place_of_supply, cgst_amount, sgst_amount, igst_amount,
        ledger_adjustments_total, round_off
      )
      SELECT account_id, v_new_number,
             REGEXP_REPLACE(title, '^(Proforma Invoice|Tax Invoice)( - | for )?', ''),
             contact_id, deal_id, conversation_id, v_uid,
             'draft', v_today, v_today + 15, currency,
             subtotal, discount_type, discount_value, discount_amount, tax_type, tax_rate, tax_amount, total_amount,
             client_name, client_phone, client_email, client_company, client_address, client_gstin,
             notes, terms, company_name, company_logo_url, company_address, company_phone, company_email,
             company_website, gstin, pan, signature_url, stamp_url, NULL, REPLACE(gen_random_uuid()::TEXT, '-', ''),
             firm_id, billed_from, billed_to, place_of_supply, cgst_amount, sgst_amount, igst_amount,
             ledger_adjustments_total, round_off
        FROM invoices WHERE id = v_src.id
      RETURNING id INTO v_new_id;
      INSERT INTO quotation_items (quotation_id, position, particular_id, title, description, service_name, sac_code,
                                   quantity, unit_price, discount_value, discount_type, gst_rate, tax_rate,
                                   taxable_amount, tax_amount, line_total, total, linked_task_ids)
      SELECT v_new_id, position, particular_id, title, description, service_name, sac_code, quantity, unit_price,
             discount_value, discount_type, COALESCE(gst_rate, tax_rate, 0), tax_rate, taxable_amount, tax_amount,
             line_total, total, linked_task_ids
        FROM invoice_items WHERE invoice_id = v_src.id;
      INSERT INTO quotation_ledger_lines (quotation_id, ledger_id, ledger_name, amount, position)
      SELECT v_new_id, ledger_id, ledger_name, amount, position FROM invoice_ledger_lines WHERE invoice_id = v_src.id;
      UPDATE invoices SET quotation_id = v_new_id
       WHERE id IN (v_inv.id, CASE WHEN v_has_pi THEN v_pi.id END, CASE WHEN v_has_ti THEN v_ti.id END);
      v_created := TRUE;
      v_target_id := v_new_id; v_target_number := v_new_number;
    END IF;
    v_target_type := 'quotation';
  END IF;

  RETURN json_build_object('target_type', v_target_type, 'target_id', v_target_id, 'target_number', v_target_number,
                           'created', v_created, 'cancelled', v_cancelled, 'payment_removed', v_payment_removed);
END;
$$;
REVOKE ALL ON FUNCTION revert_billing_document(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revert_billing_document(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
