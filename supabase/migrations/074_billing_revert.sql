-- ============================================================
-- 074_billing_revert.sql
--
-- Move a billing document BACK a stage:
--   Tax Invoice -> Proforma   (cancel the tax invoice, proforma unpaid again)
--   Tax Invoice -> Quotation  (cancel tax invoice + its proforma, reopen quote)
--   Proforma    -> Quotation  (cancel proforma (+ its tax invoice), reopen quote)
--
-- Nothing is deleted. Reverted documents become status 'cancelled'
-- with who / when / why, so numbering has no gaps and there is an
-- audit trail (important for GST tax invoices).
--
-- If the earlier stage doesn't exist (the document was created
-- directly), a fresh one is created from the document's content:
-- a new draft quotation, or a new unpaid proforma.
--
-- Adds:
--   invoices.source_invoice_id  tax invoice -> the proforma it was paid from
--   invoices.cancelled_at / cancelled_by / cancel_reason
--   revert_billing_document(invoice_id, to, reason)  — one transaction
--
-- Idempotent — safe to run more than once.
-- ============================================================

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS source_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_invoices_source_invoice ON invoices(source_invoice_id);

-- Backfill: tax invoices made by "Record Payment" copied the proforma's
-- payment exactly (same account, client, total and paid_at timestamp).
UPDATE invoices ti
   SET source_invoice_id = pi.id
  FROM invoices pi
 WHERE ti.invoice_type = 'tax_invoice'
   AND ti.source_invoice_id IS NULL
   AND pi.invoice_type = 'proforma'
   AND pi.account_id = ti.account_id
   AND pi.paid_at IS NOT NULL
   AND pi.paid_at = ti.paid_at
   AND pi.total_amount = ti.total_amount
   AND pi.client_name = ti.client_name
   AND pi.created_at <= ti.created_at;

-- ------------------------------------------------------------
-- Next document number from quotation_settings (atomic).
-- kind: 'quote' | 'proforma'
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION billing_next_number(p_account UUID, p_kind TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix TEXT;
  v_num INT;
BEGIN
  INSERT INTO quotation_settings (account_id) VALUES (p_account) ON CONFLICT (account_id) DO NOTHING;

  IF p_kind = 'quote' THEN
    UPDATE quotation_settings
       SET next_quote_number = next_quote_number + 1, updated_at = NOW()
     WHERE account_id = p_account
    RETURNING quote_prefix, next_quote_number - 1 INTO v_prefix, v_num;
    v_prefix := COALESCE(NULLIF(TRIM(v_prefix), ''), 'DF-QT-');
  ELSIF p_kind = 'proforma' THEN
    UPDATE quotation_settings
       SET next_proforma_number = next_proforma_number + 1, updated_at = NOW()
     WHERE account_id = p_account
    RETURNING proforma_prefix, next_proforma_number - 1 INTO v_prefix, v_num;
    v_prefix := COALESCE(NULLIF(TRIM(v_prefix), ''), 'DF-PI-');
  ELSE
    RAISE EXCEPTION 'Unknown numbering kind %', p_kind USING ERRCODE = '22023';
  END IF;

  RETURN v_prefix || LPAD(GREATEST(1, v_num)::TEXT, 4, '0');
END;
$$;

REVOKE ALL ON FUNCTION billing_next_number(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- revert_billing_document
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
  v_src invoices%ROWTYPE;      -- content to copy when creating a new earlier stage
  v_reason TEXT := NULLIF(LEFT(TRIM(COALESCE(p_reason, '')), 500), '');
  v_now TIMESTAMPTZ := NOW();
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

  -- Work out the chain: proforma <-> tax invoice
  IF v_inv.invoice_type = 'tax_invoice' THEN
    v_ti := v_inv; v_has_ti := TRUE;
    IF v_inv.source_invoice_id IS NOT NULL THEN
      SELECT * INTO v_pi FROM invoices
       WHERE id = v_inv.source_invoice_id AND status <> 'cancelled'
       FOR UPDATE;
      v_has_pi := FOUND;
    END IF;
  ELSE
    v_pi := v_inv; v_has_pi := TRUE;
    SELECT * INTO v_ti FROM invoices
     WHERE source_invoice_id = v_inv.id AND invoice_type = 'tax_invoice' AND status <> 'cancelled'
     ORDER BY created_at DESC LIMIT 1
     FOR UPDATE;
    v_has_ti := FOUND;
  END IF;

  -- 1. Cancel the tax invoice (if any)
  IF v_has_ti THEN
    UPDATE invoices
       SET status = 'cancelled', cancelled_at = v_now, cancelled_by = v_uid,
           cancel_reason = COALESCE(v_reason, 'Moved back to ' || p_to), updated_at = v_now
     WHERE id = v_ti.id;
    v_cancelled := v_cancelled || v_ti.invoice_number;
  END IF;

  IF p_to = 'proforma' THEN
    IF v_has_pi THEN
      -- Proforma becomes payable again; the recorded payment is removed.
      v_payment_removed := COALESCE(v_pi.paid_amount, 0);
      UPDATE invoices
         SET status = 'unpaid', paid_amount = 0, balance_amount = total_amount,
             payment_method = NULL, payment_reference = NULL, payment_notes = NULL,
             paid_at = NULL, updated_at = v_now
       WHERE id = v_pi.id;
      v_target_id := v_pi.id; v_target_number := v_pi.invoice_number;
    ELSE
      -- Tax invoice was created directly: make a new unpaid proforma from it.
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
        notes, terms, custom_message, public_token
      )
      SELECT account_id, quotation_id, 'proforma', v_new_number,
             REGEXP_REPLACE(title, '^Tax Invoice', 'Proforma Invoice'), contact_id, deal_id, conversation_id,
             v_uid, 'unpaid', (v_now AT TIME ZONE 'Asia/Kolkata')::date, ((v_now AT TIME ZONE 'Asia/Kolkata')::date + 7), currency,
             subtotal, discount_type, discount_value, discount_amount, tax_type, tax_rate, tax_amount, total_amount,
             0, total_amount,
             client_name, client_phone, client_email, client_company, client_address, client_gstin,
             company_name, company_logo_url, company_address, company_phone, company_email, company_website,
             gstin, pan, signature_url, stamp_url,
             bank_name, bank_account_no, bank_ifsc, bank_beneficiary_name, upi_id, upi_qr_url,
             notes, terms, custom_message, REPLACE(gen_random_uuid()::TEXT, '-', '')
        FROM invoices WHERE id = v_ti.id
      RETURNING id INTO v_new_id;
      INSERT INTO invoice_items (invoice_id, position, title, description, quantity, unit_price, tax_rate, total)
      SELECT v_new_id, position, title, description, quantity, unit_price, tax_rate, total
        FROM invoice_items WHERE invoice_id = v_ti.id;
      -- The cancelled tax invoice now points at its replacement proforma.
      UPDATE invoices SET source_invoice_id = v_new_id WHERE id = v_ti.id;
      v_payment_removed := COALESCE(v_ti.paid_amount, 0);
      v_created := TRUE;
      v_target_id := v_new_id; v_target_number := v_new_number;
    END IF;
    v_target_type := 'proforma';

  ELSE -- p_to = 'quotation'
    IF v_has_pi THEN
      UPDATE invoices
         SET status = 'cancelled', cancelled_at = v_now, cancelled_by = v_uid,
             cancel_reason = COALESCE(v_reason, 'Moved back to quotation'), updated_at = v_now
       WHERE id = v_pi.id;
      v_cancelled := v_cancelled || v_pi.invoice_number;
    END IF;
    v_payment_removed := GREATEST(COALESCE(CASE WHEN v_has_pi THEN v_pi.paid_amount END, 0),
                                  COALESCE(CASE WHEN v_has_ti THEN v_ti.paid_amount END, 0));

    v_qid := COALESCE(v_inv.quotation_id, CASE WHEN v_has_pi THEN v_pi.quotation_id END);
    IF v_qid IS NOT NULL THEN
      SELECT * INTO v_q FROM quotations WHERE id = v_qid AND account_id = v_inv.account_id FOR UPDATE;
    END IF;

    IF v_qid IS NOT NULL AND v_q.id IS NOT NULL THEN
      -- Reopen the original quotation.
      UPDATE quotations
         SET status = CASE WHEN sent_at IS NOT NULL THEN 'sent' ELSE 'draft' END,
             accepted_at = NULL, rejected_at = NULL, updated_at = v_now
       WHERE id = v_q.id;
      v_target_id := v_q.id; v_target_number := v_q.quote_number;
    ELSE
      -- Created directly: make a new draft quotation from the document.
      IF v_has_pi THEN v_src := v_pi; ELSE v_src := v_ti; END IF;
      v_new_number := billing_next_number(v_src.account_id, 'quote');
      INSERT INTO quotations (
        account_id, quote_number, title, contact_id, deal_id, conversation_id, created_by_user_id,
        status, issue_date, valid_until, currency,
        subtotal, discount_type, discount_value, discount_amount, tax_type, tax_rate, tax_amount, total_amount,
        client_name, client_phone, client_email, client_company, client_address, client_gstin,
        notes, terms, company_name, company_logo_url, company_address, company_phone, company_email,
        company_website, gstin, pan, signature_url, stamp_url, custom_message, public_token
      )
      SELECT account_id, v_new_number,
             REGEXP_REPLACE(title, '^(Proforma Invoice|Tax Invoice)( - | for )?', ''),
             contact_id, deal_id, conversation_id, v_uid,
             'draft', (v_now AT TIME ZONE 'Asia/Kolkata')::date, ((v_now AT TIME ZONE 'Asia/Kolkata')::date + 15), currency,
             subtotal, discount_type, discount_value, discount_amount, tax_type, tax_rate, tax_amount, total_amount,
             client_name, client_phone, client_email, client_company, client_address, client_gstin,
             notes, terms, company_name, company_logo_url, company_address, company_phone, company_email,
             company_website, gstin, pan, signature_url, stamp_url, NULL, REPLACE(gen_random_uuid()::TEXT, '-', '')
        FROM invoices WHERE id = v_src.id
      RETURNING id INTO v_new_id;
      INSERT INTO quotation_items (quotation_id, position, title, description, quantity, unit_price, tax_rate, total)
      SELECT v_new_id, position, title, description, quantity, unit_price, tax_rate, total
        FROM invoice_items WHERE invoice_id = v_src.id;
      -- Link the cancelled documents to the new quotation (history stays connected).
      UPDATE invoices SET quotation_id = v_new_id
       WHERE id IN (v_inv.id, CASE WHEN v_has_pi THEN v_pi.id END, CASE WHEN v_has_ti THEN v_ti.id END);
      v_created := TRUE;
      v_target_id := v_new_id; v_target_number := v_new_number;
    END IF;
    v_target_type := 'quotation';
  END IF;

  RETURN json_build_object(
    'target_type', v_target_type,
    'target_id', v_target_id,
    'target_number', v_target_number,
    'created', v_created,
    'cancelled', v_cancelled,
    'payment_removed', v_payment_removed
  );
END;
$$;

REVOKE ALL ON FUNCTION revert_billing_document(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION revert_billing_document(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
