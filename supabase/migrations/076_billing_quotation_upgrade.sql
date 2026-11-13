-- ============================================================
-- 076_billing_quotation_upgrade.sql
--
-- Billing module (WebLedger-style), part 1: everything the new
-- Quotation screens need. Upgrades the existing tables — no data lost.
--
--   Settings masters (per account):
--     billing_firms (+ billing_firm_bank_accounts)   who bills
--     billing_series (+ billing_series_periods)       numbering, per FY
--     billing_particulars                              service catalogue
--     billing_ledgers                                  "+ Ledger" lines
--     billing_tax_rates                                GST / VAT rate lists
--   Clients: billing fields on contacts (address, state, GSTIN, PAN…)
--   Quotations: firm / series, Billed From / Billed To snapshots,
--     CGST/SGST/IGST, ledger lines, round off, converted invoice,
--     sent ticks, soft delete. Line items: particular, service, SAC,
--     per-line discount (INR/%), GST rate, tax, line total, tasks.
--   Statuses become Draft / Final / Invoiced / Cancelled. A trigger
--     maps the old values (sent/accepted -> final, rejected/expired ->
--     cancelled) so older code keeps working during the rollout.
--   Numbering: billing_series_allocate() — locked, never duplicates.
--
-- Seeds each account from its current quotation settings: a default
-- firm (+ bank / UPI), a default "Quotation" series continuing the
-- current DF-QT- numbers, GST 0/5/12/18/28, VAT 0/5, common ledgers,
-- and particulars from items already used on quotations.
--
-- Idempotent — safe to run more than once.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Company state on the existing Settings -> Billing page
--    (decides CGST + SGST vs IGST). Settings -> Billing stays the one
--    place to edit company + bank details; section 11 copies them to
--    the default firm automatically.
-- ------------------------------------------------------------
ALTER TABLE quotation_settings ADD COLUMN IF NOT EXISTS company_state TEXT;

-- ------------------------------------------------------------
-- 1. Client billing fields
-- ------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT,
  ADD COLUMN IF NOT EXISTS gstin TEXT,
  ADD COLUMN IF NOT EXISTS pan TEXT,
  ADD COLUMN IF NOT EXISTS cin TEXT,
  ADD COLUMN IF NOT EXISTS proprietor_name TEXT;

-- ------------------------------------------------------------
-- 2. Firms and their bank accounts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_firms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tax_type TEXT NOT NULL DEFAULT 'GST' CHECK (tax_type IN ('GST', 'NONE')),
  gstin TEXT,
  default_gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  pan TEXT, cin TEXT, tan TEXT, tin TEXT, vat_no TEXT,
  logo_url TEXT,
  address_line1 TEXT, address_line2 TEXT, pincode TEXT, landmark TEXT,
  country TEXT NOT NULL DEFAULT 'India', state TEXT, city TEXT,
  phone_country_code TEXT NOT NULL DEFAULT '+91', phone TEXT, email TEXT, website TEXT,
  credit_period_days INTEGER NOT NULL DEFAULT 0 CHECK (credit_period_days BETWEEN 0 AND 3650),
  terms_and_conditions TEXT,
  signature_url TEXT, stamp_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_firms_default ON billing_firms(account_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_billing_firms_account ON billing_firms(account_id);

CREATE TABLE IF NOT EXISTS billing_firm_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  firm_id UUID NOT NULL REFERENCES billing_firms(id) ON DELETE CASCADE,
  account_holder_name TEXT NOT NULL,
  account_no TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'Current' CHECK (account_type IN ('Savings', 'Current', 'OD', 'CC')),
  bank_name TEXT NOT NULL,
  ifsc TEXT, branch_name TEXT, micr TEXT, upi_id TEXT, swift_code TEXT,
  upi_qr_url TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_bank_default ON billing_firm_bank_accounts(firm_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_billing_bank_firm ON billing_firm_bank_accounts(firm_id);

-- ------------------------------------------------------------
-- 3. Series (numbering) and their dated periods
--    number = prefix || running_no || suffix   e.g. TOR/26-27/QU + 103
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  firm_id UUID NOT NULL REFERENCES billing_firms(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('quotation', 'invoice', 'receipt')),
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_series_default ON billing_series(firm_id, doc_type) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_billing_series_firm ON billing_series(firm_id, doc_type);

CREATE TABLE IF NOT EXISTS billing_series_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL REFERENCES billing_series(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  applicable_from DATE,          -- NULL = undated fallback row
  applicable_to DATE,
  starting_no INTEGER NOT NULL DEFAULT 1 CHECK (starting_no >= 0),
  next_no INTEGER NOT NULL DEFAULT 1 CHECK (next_no >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (applicable_to IS NULL OR applicable_from IS NULL OR applicable_to >= applicable_from)
);
CREATE INDEX IF NOT EXISTS idx_billing_series_periods ON billing_series_periods(series_id, position);

-- ------------------------------------------------------------
-- 4. Particulars, ledgers, tax rates
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_particulars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  service_name TEXT,
  gst_rate NUMERIC(5,2),
  vat_rate NUMERIC(5,2),
  sac_code TEXT,
  description TEXT,
  default_amount NUMERIC(12,2),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_particulars_account ON billing_particulars(account_id, name);

CREATE TABLE IF NOT EXISTS billing_ledgers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ledger_group TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_ledgers_name ON billing_ledgers(account_id, LOWER(name));

CREATE TABLE IF NOT EXISTS billing_tax_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('GST', 'VAT')),
  rate NUMERIC(5,2) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_tax_rates ON billing_tax_rates(account_id, kind, rate);

-- ------------------------------------------------------------
-- 5. Quotations: new columns, line-item columns, ledger lines
-- ------------------------------------------------------------
ALTER TABLE quotations
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
  ADD COLUMN IF NOT EXISTS converted_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_whatsapp_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_email_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quotations_firm ON quotations(firm_id);
CREATE INDEX IF NOT EXISTS idx_quotations_account_date ON quotations(account_id, issue_date DESC);

ALTER TABLE quotation_items
  ADD COLUMN IF NOT EXISTS particular_id UUID REFERENCES billing_particulars(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_name TEXT,
  ADD COLUMN IF NOT EXISTS sac_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_type TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS line_total NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS linked_task_ids UUID[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE quotation_items ADD CONSTRAINT quotation_items_discount_type_check CHECK (discount_type IN ('INR', 'PERCENT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS quotation_ledger_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  ledger_id UUID REFERENCES billing_ledgers(id) ON DELETE SET NULL,
  ledger_name TEXT NOT NULL,           -- snapshot, prints as the line label
  amount NUMERIC(12,2) NOT NULL,       -- may be negative
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quotation_ledger_lines ON quotation_ledger_lines(quotation_id, position);

-- ------------------------------------------------------------
-- 6. Statuses: draft / final / invoiced / cancelled
-- ------------------------------------------------------------
ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_status_check;

-- Map legacy values on every write (older code may still send them).
CREATE OR REPLACE FUNCTION quotations_normalize()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('sent', 'accepted') THEN
    NEW.status := 'final';
  ELSIF NEW.status IN ('rejected', 'expired') THEN
    NEW.status := 'cancelled';
  END IF;

  -- Moving an invoiced quotation back (074 revert) reopens it as Final
  -- if it had been finalised, not as Draft.
  IF TG_OP = 'UPDATE' AND OLD.status = 'invoiced' AND NEW.status = 'draft' AND OLD.finalized_at IS NOT NULL THEN
    NEW.status := 'final';
  END IF;

  -- Final or invoiced means it has been finalised.
  IF NEW.status IN ('final', 'invoiced') AND NEW.finalized_at IS NULL THEN
    NEW.finalized_at := NOW();
  END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := NOW();
  END IF;
  IF NEW.status <> 'cancelled' THEN
    NEW.cancelled_at := NULL;
  END IF;
  IF NEW.status <> 'invoiced' THEN
    NEW.converted_invoice_id := NULL;
  END IF;

  -- New quotations default to the account's default firm + quotation series.
  IF TG_OP = 'INSERT' AND NEW.firm_id IS NULL THEN
    SELECT id INTO NEW.firm_id FROM billing_firms
     WHERE account_id = NEW.account_id AND is_default LIMIT 1;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.series_id IS NULL AND NEW.firm_id IS NOT NULL THEN
    SELECT id INTO NEW.series_id FROM billing_series
     WHERE firm_id = NEW.firm_id AND doc_type = 'quotation' AND is_default LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quotations_normalize ON quotations;
CREATE TRIGGER trg_quotations_normalize
  BEFORE INSERT OR UPDATE ON quotations
  FOR EACH ROW EXECUTE FUNCTION quotations_normalize();

-- ------------------------------------------------------------
-- 7. Numbering
-- ------------------------------------------------------------

-- Pick the period for a date: the dated row covering it, else the
-- undated fallback row. Shared by allocate + preview.
CREATE OR REPLACE FUNCTION billing_series_period_for(p_series_id UUID, p_date DATE)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM (
    SELECT id, 0 AS pri, applicable_from, position FROM billing_series_periods
     WHERE series_id = p_series_id AND applicable_from IS NOT NULL
       AND p_date >= applicable_from AND p_date <= COALESCE(applicable_to, DATE '9999-12-31')
    UNION ALL
    SELECT id, 1, NULL, position FROM billing_series_periods
     WHERE series_id = p_series_id AND applicable_from IS NULL
  ) x
  ORDER BY pri, applicable_from DESC NULLS LAST, position
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION billing_number_taken(p_account UUID, p_doc_type TEXT, p_number TEXT, p_exclude UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_doc_type
    WHEN 'quotation' THEN EXISTS (SELECT 1 FROM quotations WHERE account_id = p_account AND quote_number = p_number AND id IS DISTINCT FROM p_exclude)
    WHEN 'invoice'   THEN EXISTS (SELECT 1 FROM invoices   WHERE account_id = p_account AND invoice_number = p_number AND id IS DISTINCT FROM p_exclude)
    ELSE FALSE
  END
$$;

-- Allocate the next number from a series (or a specific running number
-- the user typed). Locks the period row: concurrent saves never collide.
-- Returns { number, period_id, running_no }.
CREATE OR REPLACE FUNCTION billing_series_allocate(p_series_id UUID, p_doc_date DATE, p_requested INTEGER DEFAULT NULL, p_exclude UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_series billing_series%ROWTYPE;
  v_period billing_series_periods%ROWTYPE;
  v_n INTEGER;
  v_number TEXT;
  v_guard INTEGER := 0;
BEGIN
  SELECT * INTO v_series FROM billing_series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT is_account_member(v_series.account_id, 'agent') THEN
    RAISE EXCEPTION 'You don''t have permission to number documents' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_period FROM billing_series_periods
   WHERE id = billing_series_period_for(p_series_id, COALESCE(p_doc_date, CURRENT_DATE))
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series "%" has no numbering for %', v_series.name, COALESCE(p_doc_date, CURRENT_DATE)
      USING ERRCODE = '22023';
  END IF;

  IF p_requested IS NOT NULL THEN
    IF p_requested < 0 THEN
      RAISE EXCEPTION 'Number must be positive' USING ERRCODE = '22023';
    END IF;
    v_n := p_requested;
    v_number := v_period.prefix || v_n || v_period.suffix;
    IF billing_number_taken(v_series.account_id, v_series.doc_type, v_number, p_exclude) THEN
      RAISE EXCEPTION 'Number % is already used', v_number USING ERRCODE = '23505';
    END IF;
  ELSE
    v_n := GREATEST(v_period.next_no, v_period.starting_no);
    LOOP
      v_number := v_period.prefix || v_n || v_period.suffix;
      EXIT WHEN NOT billing_number_taken(v_series.account_id, v_series.doc_type, v_number, p_exclude);
      v_n := v_n + 1;
      v_guard := v_guard + 1;
      IF v_guard > 100000 THEN
        RAISE EXCEPTION 'Could not find a free number' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  UPDATE billing_series_periods SET next_no = GREATEST(next_no, v_n + 1) WHERE id = v_period.id;

  RETURN json_build_object('number', v_number, 'period_id', v_period.id, 'running_no', v_n,
                           'prefix', v_period.prefix, 'suffix', v_period.suffix);
END;
$$;

-- What the next number WOULD be (form preview) — does not consume it.
CREATE OR REPLACE FUNCTION billing_series_preview(p_series_id UUID, p_doc_date DATE)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_series billing_series%ROWTYPE;
  v_period billing_series_periods%ROWTYPE;
  v_n INTEGER;
  v_guard INTEGER := 0;
BEGIN
  SELECT * INTO v_series FROM billing_series WHERE id = p_series_id;
  IF NOT FOUND OR NOT is_account_member(v_series.account_id) THEN
    RAISE EXCEPTION 'Series not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_period FROM billing_series_periods
   WHERE id = billing_series_period_for(p_series_id, COALESCE(p_doc_date, CURRENT_DATE));
  IF NOT FOUND THEN
    RETURN json_build_object('number', NULL, 'period_id', NULL, 'running_no', NULL, 'prefix', NULL, 'suffix', NULL);
  END IF;
  v_n := GREATEST(v_period.next_no, v_period.starting_no);
  WHILE billing_number_taken(v_series.account_id, v_series.doc_type, v_period.prefix || v_n || v_period.suffix) AND v_guard < 100000 LOOP
    v_n := v_n + 1; v_guard := v_guard + 1;
  END LOOP;
  RETURN json_build_object('number', v_period.prefix || v_n || v_period.suffix, 'period_id', v_period.id,
                           'running_no', v_n, 'prefix', v_period.prefix, 'suffix', v_period.suffix);
END;
$$;

REVOKE ALL ON FUNCTION billing_series_period_for(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION billing_number_taken(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION billing_series_allocate(UUID, DATE, INTEGER, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION billing_series_preview(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION billing_series_period_for(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION billing_series_allocate(UUID, DATE, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION billing_series_preview(UUID, DATE) TO authenticated;

-- Quotation numbers from older paths (next_document_number('quote'),
-- revert in 074) now come from the default quotation series too.
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
BEGIN
  IF p_kind NOT IN ('quote', 'proforma', 'tax_invoice') THEN
    RAISE EXCEPTION 'Unknown numbering kind %', p_kind USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'quote' THEN
    SELECT s.id INTO v_series
      FROM billing_series s JOIN billing_firms f ON f.id = s.firm_id
     WHERE s.account_id = p_account AND s.doc_type = 'quotation' AND s.is_default AND f.is_default
     LIMIT 1;
    IF v_series IS NOT NULL THEN
      RETURN billing_series_allocate(v_series, CURRENT_DATE) ->> 'number';
    END IF;
  END IF;

  INSERT INTO quotation_settings (account_id) VALUES (p_account) ON CONFLICT (account_id) DO NOTHING;

  SELECT CASE p_kind WHEN 'quote' THEN quote_prefix WHEN 'proforma' THEN proforma_prefix ELSE tax_invoice_prefix END,
         CASE p_kind WHEN 'quote' THEN next_quote_number WHEN 'proforma' THEN next_proforma_number ELSE next_tax_invoice_number END
    INTO v_prefix, v_counter
    FROM quotation_settings
   WHERE account_id = p_account
   FOR UPDATE;

  v_prefix := COALESCE(NULLIF(TRIM(v_prefix), ''),
                       CASE p_kind WHEN 'quote' THEN 'DF-QT-' WHEN 'proforma' THEN 'DF-PI-' ELSE 'DF-TI-' END);

  IF p_kind = 'quote' THEN
    SELECT MAX(SUBSTR(quote_number, LENGTH(v_prefix) + 1)::INT) INTO v_max
      FROM quotations
     WHERE account_id = p_account
       AND LEFT(quote_number, LENGTH(v_prefix)) = v_prefix
       AND SUBSTR(quote_number, LENGTH(v_prefix) + 1) ~ '^[0-9]{1,9}$';
  ELSE
    SELECT MAX(SUBSTR(invoice_number, LENGTH(v_prefix) + 1)::INT) INTO v_max
      FROM invoices
     WHERE account_id = p_account
       AND invoice_type = p_kind
       AND LEFT(invoice_number, LENGTH(v_prefix)) = v_prefix
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
-- 8. Row level security
--    read: any member · masters: Team Leader+ · particulars and
--    quotation ledger lines: Team Member+
-- ------------------------------------------------------------
ALTER TABLE billing_firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_firm_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_series_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_particulars ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_ledger_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  writer TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['billing_firms', 'billing_firm_bank_accounts', 'billing_series', 'billing_ledgers', 'billing_tax_rates', 'billing_particulars']
  LOOP
    writer := CASE WHEN t = 'billing_particulars' THEN 'agent'
                   WHEN t = 'billing_firm_bank_accounts' THEN 'owner'
                   ELSE 'admin' END;
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (is_account_member(account_id))', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (is_account_member(account_id, %L)) WITH CHECK (is_account_member(account_id, %L))',
                   t || '_write', t, writer, writer);
  END LOOP;
END $$;

DROP POLICY IF EXISTS billing_series_periods_select ON billing_series_periods;
CREATE POLICY billing_series_periods_select ON billing_series_periods FOR SELECT
  USING (EXISTS (SELECT 1 FROM billing_series s WHERE s.id = series_id AND is_account_member(s.account_id)));
DROP POLICY IF EXISTS billing_series_periods_write ON billing_series_periods;
CREATE POLICY billing_series_periods_write ON billing_series_periods FOR ALL
  USING (EXISTS (SELECT 1 FROM billing_series s WHERE s.id = series_id AND is_account_member(s.account_id, 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM billing_series s WHERE s.id = series_id AND is_account_member(s.account_id, 'admin')));

DROP POLICY IF EXISTS quotation_ledger_lines_select ON quotation_ledger_lines;
CREATE POLICY quotation_ledger_lines_select ON quotation_ledger_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND is_account_member(q.account_id)));
DROP POLICY IF EXISTS quotation_ledger_lines_write ON quotation_ledger_lines;
CREATE POLICY quotation_ledger_lines_write ON quotation_ledger_lines FOR ALL
  USING (EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND is_account_member(q.account_id, 'agent')))
  WITH CHECK (EXISTS (SELECT 1 FROM quotations q WHERE q.id = quotation_id AND is_account_member(q.account_id, 'agent')));

-- ------------------------------------------------------------
-- 9. Seed every account from its current settings (only once)
-- ------------------------------------------------------------
DO $$
DECLARE
  a RECORD;
  v_firm UUID;
  v_series UUID;
  v_prefix TEXT;
  v_next INT;
  v_max INT;
  v_state TEXT;
  states TEXT[] := ARRAY['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana',
    'Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
    'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand',
    'West Bengal','Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi',
    'Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry'];
BEGIN
  FOR a IN
    SELECT ac.id AS account_id, qs.company_name, qs.company_address, qs.company_phone, qs.company_email,
           qs.company_website, qs.company_logo_url, qs.gstin, qs.pan, qs.default_terms, qs.signature_url,
           qs.stamp_url, qs.default_tax_rate, qs.bank_name, qs.bank_account_no, qs.bank_ifsc,
           qs.bank_beneficiary_name, qs.upi_id, qs.upi_qr_url, qs.quote_prefix, qs.next_quote_number,
           qs.company_state
      FROM accounts ac
      LEFT JOIN quotation_settings qs ON qs.account_id = ac.id
     WHERE NOT EXISTS (SELECT 1 FROM billing_firms f WHERE f.account_id = ac.id)
       AND (qs.account_id IS NOT NULL OR EXISTS (SELECT 1 FROM quotations q WHERE q.account_id = ac.id))
  LOOP
    -- State from the company address, e.g. "Hyderabad, Telangana, India".
    v_state := NULLIF(TRIM(a.company_state), '');
    IF v_state IS NULL THEN
      SELECT s INTO v_state FROM unnest(states) s
       WHERE COALESCE(a.company_address, '') ILIKE '%' || s || '%'
       ORDER BY LENGTH(s) DESC LIMIT 1;
    END IF;
      IF v_state IS NULL AND COALESCE(a.company_address, '') ILIKE '%hyderabad%' THEN v_state := 'Telangana'; END IF;
    -- Show the detected state on the Settings page too.
    IF v_state IS NOT NULL THEN
      UPDATE quotation_settings SET company_state = v_state WHERE account_id = a.account_id AND company_state IS NULL;
    END IF;

    INSERT INTO billing_firms (account_id, name, gstin, pan, logo_url, address_line1, state, phone, email, website,
                               terms_and_conditions, signature_url, stamp_url, default_gst_rate, is_default)
    VALUES (a.account_id, COALESCE(NULLIF(TRIM(a.company_name), ''), 'Deccan Filings'), a.gstin, a.pan, a.company_logo_url,
            a.company_address, v_state, a.company_phone, a.company_email, a.company_website, a.default_terms,
            a.signature_url, a.stamp_url, COALESCE(a.default_tax_rate, 18), TRUE)
    RETURNING id INTO v_firm;

    IF COALESCE(a.bank_account_no, '') <> '' OR COALESCE(a.upi_id, '') <> '' THEN
      INSERT INTO billing_firm_bank_accounts (account_id, firm_id, account_holder_name, account_no, bank_name, ifsc,
                                              upi_id, upi_qr_url, is_default)
      VALUES (a.account_id, v_firm,
              COALESCE(NULLIF(a.bank_beneficiary_name, ''), COALESCE(NULLIF(TRIM(a.company_name), ''), 'Deccan Filings')),
              COALESCE(NULLIF(a.bank_account_no, ''), '-'), COALESCE(NULLIF(a.bank_name, ''), 'Bank'),
              a.bank_ifsc, a.upi_id, a.upi_qr_url, TRUE);
    END IF;

    -- Default quotation series continuing the current numbers.
    v_prefix := COALESCE(NULLIF(TRIM(a.quote_prefix), ''), 'DF-QT-');
    SELECT MAX(SUBSTR(quote_number, LENGTH(v_prefix) + 1)::INT) INTO v_max
      FROM quotations
     WHERE account_id = a.account_id
       AND LEFT(quote_number, LENGTH(v_prefix)) = v_prefix
       AND SUBSTR(quote_number, LENGTH(v_prefix) + 1) ~ '^[0-9]{1,9}$';
    v_next := GREATEST(COALESCE(a.next_quote_number, 1001), COALESCE(v_max, 0) + 1);

    INSERT INTO billing_series (account_id, firm_id, doc_type, name, is_default)
    VALUES (a.account_id, v_firm, 'quotation', 'Quotation', TRUE)
    RETURNING id INTO v_series;
    INSERT INTO billing_series_periods (series_id, position, prefix, suffix, starting_no, next_no)
    VALUES (v_series, 0, v_prefix, '', 1001, v_next);
  END LOOP;

  -- Tax rates
  INSERT INTO billing_tax_rates (account_id, kind, rate)
  SELECT f.account_id, k.kind, k.rate
    FROM (SELECT DISTINCT account_id FROM billing_firms) f
   CROSS JOIN (VALUES ('GST', 0), ('GST', 5), ('GST', 12), ('GST', 18), ('GST', 28), ('VAT', 0), ('VAT', 5)) AS k(kind, rate)
   WHERE NOT EXISTS (SELECT 1 FROM billing_tax_rates t WHERE t.account_id = f.account_id)
  ON CONFLICT DO NOTHING;

  -- Common ledgers
  INSERT INTO billing_ledgers (account_id, name, ledger_group)
  SELECT f.account_id, l.name, l.grp
    FROM (SELECT DISTINCT account_id FROM billing_firms) f
   CROSS JOIN (VALUES ('Government Fees', 'Direct Expenses'),
                      ('Courier Charges', 'Indirect Incomes'),
                      ('Discount Allowed', 'Indirect Expenses'),
                      ('Bad Debts', 'Indirect Expenses')) AS l(name, grp)
   WHERE NOT EXISTS (SELECT 1 FROM billing_ledgers x WHERE x.account_id = f.account_id)
  ON CONFLICT DO NOTHING;

  -- Particulars from line items already used on quotations (latest price wins).
  INSERT INTO billing_particulars (account_id, name, description, default_amount, gst_rate)
  SELECT DISTINCT ON (q.account_id, LOWER(TRIM(i.title)))
         q.account_id, TRIM(i.title), NULLIF(TRIM(i.description), ''), i.unit_price,
         CASE WHEN q.tax_type = 'none' THEN 0 ELSE q.tax_rate END
    FROM quotation_items i
    JOIN quotations q ON q.id = i.quotation_id
   WHERE TRIM(COALESCE(i.title, '')) <> ''
     AND NOT EXISTS (SELECT 1 FROM billing_particulars p WHERE p.account_id = q.account_id)
   ORDER BY q.account_id, LOWER(TRIM(i.title)), i.created_at DESC;
END $$;

-- ------------------------------------------------------------
-- 10. Backfill existing quotations into the new structure
-- ------------------------------------------------------------

-- Converted quotations -> invoiced (latest active invoice).
UPDATE quotations q
   SET status = 'invoiced',
       finalized_at = COALESCE(q.finalized_at, q.sent_at, q.accepted_at, q.updated_at),
       converted_invoice_id = (SELECT i.id FROM invoices i
                                WHERE i.quotation_id = q.id AND i.status <> 'cancelled'
                                ORDER BY i.created_at DESC LIMIT 1)
 WHERE q.status IN ('draft', 'sent', 'accepted', 'final')
   AND EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id AND i.status <> 'cancelled');

-- sent/accepted -> final, rejected/expired -> cancelled (the trigger maps them).
UPDATE quotations
   SET status = status,
       finalized_at = CASE WHEN status IN ('sent', 'accepted') THEN COALESCE(finalized_at, sent_at, accepted_at, updated_at) END,
       cancelled_at = CASE WHEN status IN ('rejected', 'expired') THEN COALESCE(cancelled_at, rejected_at, updated_at) END
 WHERE status IN ('sent', 'accepted', 'rejected', 'expired');

UPDATE quotations q
   SET firm_id = COALESCE(q.firm_id, f.id),
       series_id = COALESCE(q.series_id, (SELECT s.id FROM billing_series s
                                            WHERE s.firm_id = f.id AND s.doc_type = 'quotation' AND s.is_default LIMIT 1)),
       billed_from = COALESCE(q.billed_from, jsonb_strip_nulls(jsonb_build_object(
         'name', COALESCE(NULLIF(q.company_name, ''), f.name),
         'address', COALESCE(NULLIF(q.company_address, ''), f.address_line1),
         'phone', COALESCE(NULLIF(q.company_phone, ''), f.phone),
         'email', COALESCE(NULLIF(q.company_email, ''), f.email),
         'website', COALESCE(NULLIF(q.company_website, ''), f.website),
         'gstin', COALESCE(NULLIF(q.gstin, ''), f.gstin),
         'pan', COALESCE(NULLIF(q.pan, ''), f.pan),
         'state', f.state,
         'logo_url', COALESCE(NULLIF(q.company_logo_url, ''), f.logo_url)))),
       billed_to = COALESCE(q.billed_to, jsonb_strip_nulls(jsonb_build_object(
         'name', COALESCE(NULLIF(q.client_company, ''), q.client_name), 'contact_name', q.client_name,
         'address', q.client_address, 'phone', q.client_phone, 'email', q.client_email, 'gstin', q.client_gstin))),
       -- Old quotations were all one tax line: split it as CGST + SGST (same state).
       cgst_amount = CASE WHEN q.cgst_amount = 0 AND q.sgst_amount = 0 AND q.igst_amount = 0
                          THEN ROUND(COALESCE(q.tax_amount, 0) / 2, 2) ELSE q.cgst_amount END,
       sgst_amount = CASE WHEN q.cgst_amount = 0 AND q.sgst_amount = 0 AND q.igst_amount = 0
                          THEN COALESCE(q.tax_amount, 0) - ROUND(COALESCE(q.tax_amount, 0) / 2, 2) ELSE q.sgst_amount END
  FROM billing_firms f
 WHERE f.account_id = q.account_id AND f.is_default
   AND (q.firm_id IS NULL OR q.billed_from IS NULL);

UPDATE quotation_items i
   SET gst_rate = CASE WHEN q.tax_type = 'none' THEN 0 ELSE COALESCE(q.tax_rate, 0) END,
       taxable_amount = COALESCE(i.total, 0),
       tax_amount = ROUND(COALESCE(i.total, 0) * (CASE WHEN q.tax_type = 'none' THEN 0 ELSE COALESCE(q.tax_rate, 0) END) / 100, 2),
       line_total = COALESCE(i.total, 0)
                    + ROUND(COALESCE(i.total, 0) * (CASE WHEN q.tax_type = 'none' THEN 0 ELSE COALESCE(q.tax_rate, 0) END) / 100, 2)
  FROM quotations q
 WHERE q.id = i.quotation_id AND i.line_total IS NULL;

-- Enforce the new statuses (after the data is mapped).
DO $$ BEGIN
  ALTER TABLE quotations ADD CONSTRAINT quotations_status_check
    CHECK (status IN ('draft', 'final', 'invoiced', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 11. Settings -> Billing is the single source of company + bank
--     details: every save copies them to the default firm and its
--     default bank account.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_sync_firm_from_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_firm UUID;
  v_bank UUID;
  v_series UUID;
  v_has_bank BOOLEAN := COALESCE(NEW.bank_account_no, '') <> '' OR COALESCE(NEW.upi_id, '') <> '';
BEGIN
  SELECT id INTO v_firm FROM billing_firms WHERE account_id = NEW.account_id AND is_default LIMIT 1;

  IF v_firm IS NULL THEN
    INSERT INTO billing_firms (account_id, name, is_default)
    VALUES (NEW.account_id, COALESCE(NULLIF(TRIM(NEW.company_name), ''), 'Deccan Filings'), TRUE)
    RETURNING id INTO v_firm;
  END IF;

  UPDATE billing_firms
     SET name = COALESCE(NULLIF(TRIM(NEW.company_name), ''), name),
         gstin = NEW.gstin,
         pan = NEW.pan,
         logo_url = NEW.company_logo_url,
         address_line1 = NEW.company_address,
         state = COALESCE(NULLIF(TRIM(NEW.company_state), ''), state),
         phone = NEW.company_phone,
         email = NEW.company_email,
         website = NEW.company_website,
         terms_and_conditions = NEW.default_terms,
         signature_url = NEW.signature_url,
         stamp_url = NEW.stamp_url,
         default_gst_rate = COALESCE(NEW.default_tax_rate, default_gst_rate),
         updated_at = NOW()
   WHERE id = v_firm;

  SELECT id INTO v_bank FROM billing_firm_bank_accounts WHERE firm_id = v_firm AND is_default LIMIT 1;
  IF v_has_bank THEN
    IF v_bank IS NULL THEN
      INSERT INTO billing_firm_bank_accounts (account_id, firm_id, account_holder_name, account_no, bank_name,
                                              ifsc, upi_id, upi_qr_url, is_default)
      VALUES (NEW.account_id, v_firm,
              COALESCE(NULLIF(NEW.bank_beneficiary_name, ''), COALESCE(NULLIF(TRIM(NEW.company_name), ''), 'Deccan Filings')),
              COALESCE(NULLIF(NEW.bank_account_no, ''), '-'), COALESCE(NULLIF(NEW.bank_name, ''), 'Bank'),
              NEW.bank_ifsc, NEW.upi_id, NEW.upi_qr_url, TRUE);
    ELSE
      UPDATE billing_firm_bank_accounts
         SET account_holder_name = COALESCE(NULLIF(NEW.bank_beneficiary_name, ''), account_holder_name),
             account_no = COALESCE(NULLIF(NEW.bank_account_no, ''), '-'),
             bank_name = COALESCE(NULLIF(NEW.bank_name, ''), 'Bank'),
             ifsc = NEW.bank_ifsc,
             upi_id = NEW.upi_id,
             upi_qr_url = NEW.upi_qr_url,
             updated_at = NOW()
       WHERE id = v_bank;
    END IF;
  ELSIF v_bank IS NOT NULL THEN
    DELETE FROM billing_firm_bank_accounts WHERE id = v_bank;
  END IF;

  -- Make sure there is always a default quotation series.
  IF NOT EXISTS (SELECT 1 FROM billing_series WHERE firm_id = v_firm AND doc_type = 'quotation') THEN
    INSERT INTO billing_series (account_id, firm_id, doc_type, name, is_default)
    VALUES (NEW.account_id, v_firm, 'quotation', 'Quotation', TRUE)
    RETURNING id INTO v_series;
    INSERT INTO billing_series_periods (series_id, position, prefix, suffix, starting_no, next_no)
    VALUES (v_series, 0, COALESCE(NULLIF(TRIM(NEW.quote_prefix), ''), 'DF-QT-'), '', 1001,
            GREATEST(COALESCE(NEW.next_quote_number, 1001), 1));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION billing_sync_firm_from_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_billing_sync_firm ON quotation_settings;
CREATE TRIGGER trg_billing_sync_firm
  AFTER INSERT OR UPDATE ON quotation_settings
  FOR EACH ROW EXECUTE FUNCTION billing_sync_firm_from_settings();

-- ------------------------------------------------------------
-- 12. Save a quotation from the new form in ONE transaction:
--     number (series), header, line items, ledger lines.
--     Totals are computed by the app's calculation engine (tested)
--     and stored as given. p_id NULL = create.
--     p_running_no: the number the user typed (NULL = next free / keep).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_save_quotation(p_id UUID, p_doc JSONB, p_items JSONB, p_ledgers JSONB, p_running_no INTEGER DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_account UUID;
  v_q quotations%ROWTYPE;
  v_series UUID := NULLIF(p_doc->>'series_id', '')::UUID;
  v_date DATE := COALESCE(NULLIF(p_doc->>'issue_date', '')::DATE, CURRENT_DATE);
  v_alloc JSON;
  v_number TEXT;
  v_period UUID;
  v_running INTEGER;
  v_id UUID;
  v_status TEXT := COALESCE(NULLIF(p_doc->>'status', ''), 'draft');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_uid;
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'You don''t have permission to save quotations' USING ERRCODE = '42501';
  END IF;
  IF v_status NOT IN ('draft', 'final') THEN
    RAISE EXCEPTION 'Save as Draft or Final' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Add at least one line item' USING ERRCODE = '22023';
  END IF;
  IF v_series IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM billing_series WHERE id = v_series AND account_id = v_account AND doc_type = 'quotation') THEN
    RAISE EXCEPTION 'Pick a quotation series' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_q FROM quotations WHERE id = p_id AND account_id = v_account AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quotation not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_q.status IN ('invoiced', 'cancelled') THEN
      RAISE EXCEPTION 'An % quotation can''t be edited', v_q.status USING ERRCODE = '22023';
    END IF;
    -- A finalised quotation stays final.
    IF v_q.status = 'final' THEN v_status := 'final'; END IF;
  END IF;

  -- Number: new quotation, a typed number, or a different series.
  IF v_series IS NOT NULL AND (
       p_id IS NULL
       OR (p_running_no IS NOT NULL AND p_running_no IS DISTINCT FROM v_q.running_no)
       OR v_series IS DISTINCT FROM v_q.series_id) THEN
    v_alloc := billing_series_allocate(v_series, v_date, p_running_no, p_id);
    v_number := v_alloc->>'number';
    v_period := (v_alloc->>'period_id')::UUID;
    v_running := (v_alloc->>'running_no')::INTEGER;
  ELSIF p_id IS NOT NULL THEN
    v_number := v_q.quote_number; v_period := v_q.series_period_id; v_running := v_q.running_no;
  ELSE
    v_number := billing_next_number(v_account, 'quote');
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO quotations (account_id, quote_number, title, client_name, created_by_user_id, status, public_token)
    VALUES (v_account, v_number, COALESCE(NULLIF(p_doc->>'title', ''), 'Quotation'),
            COALESCE(NULLIF(p_doc->>'client_name', ''), 'Client'), v_uid, 'draft',
            REPLACE(gen_random_uuid()::TEXT, '-', ''))
    RETURNING id INTO v_id;
  ELSE
    v_id := p_id;
  END IF;

  UPDATE quotations SET
    quote_number = v_number,
    series_id = v_series,
    series_period_id = v_period,
    running_no = v_running,
    firm_id = COALESCE(NULLIF(p_doc->>'firm_id', '')::UUID, firm_id),
    status = v_status,
    title = COALESCE(NULLIF(p_doc->>'title', ''), 'Quotation'),
    issue_date = v_date,
    valid_until = NULLIF(p_doc->>'valid_until', '')::DATE,
    contact_id = NULLIF(p_doc->>'contact_id', '')::UUID,
    deal_id = COALESCE(NULLIF(p_doc->>'deal_id', '')::UUID, deal_id),
    conversation_id = COALESCE(NULLIF(p_doc->>'conversation_id', '')::UUID, conversation_id),
    billed_from = p_doc->'billed_from',
    billed_to = p_doc->'billed_to',
    place_of_supply = NULLIF(p_doc->>'place_of_supply', ''),
    -- Legacy columns kept in step (PDF, public link, WhatsApp, convert).
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
    currency = COALESCE(NULLIF(p_doc->>'currency', ''), 'INR'),
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
    total_amount = COALESCE((p_doc->>'total_amount')::NUMERIC, 0),
    notes = NULLIF(p_doc->>'notes', ''),
    terms = NULLIF(p_doc->>'terms', ''),
    updated_at = NOW()
  WHERE id = v_id;

  DELETE FROM quotation_items WHERE quotation_id = v_id;
  INSERT INTO quotation_items (quotation_id, position, particular_id, title, description, service_name, sac_code,
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

  DELETE FROM quotation_ledger_lines WHERE quotation_id = v_id;
  IF jsonb_typeof(p_ledgers) = 'array' THEN
    INSERT INTO quotation_ledger_lines (quotation_id, ledger_id, ledger_name, amount, position)
    SELECT v_id, NULLIF(e.l->>'ledger_id', '')::UUID, COALESCE(NULLIF(e.l->>'ledger_name', ''), 'Ledger'),
           COALESCE((e.l->>'amount')::NUMERIC, 0), (e.ord - 1)::INT
      FROM jsonb_array_elements(p_ledgers) WITH ORDINALITY AS e(l, ord);
  END IF;

  RETURN json_build_object('id', v_id, 'quote_number', v_number, 'status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION billing_save_quotation(UUID, JSONB, JSONB, JSONB, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION billing_save_quotation(UUID, JSONB, JSONB, JSONB, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
