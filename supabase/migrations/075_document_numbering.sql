-- ============================================================
-- 075_document_numbering.sql
--
-- Fix: "duplicate key value violates unique constraint
-- idx_quotations_account_quote_number".
--
-- Cause: the next-number counters live in quotation_settings, which
-- only owners / Team Leaders may update (RLS). When a Team Member
-- created a quotation / proforma / tax invoice the counter update was
-- silently blocked, so the counter fell behind and the next document
-- got a number that was already used.
--
-- Fix: numbers are handed out inside the database, in one locked step:
--   next_document_number(kind)   kind = quote | proforma | tax_invoice
--     - any account member with Team Member (agent) role or above
--     - locks the settings row, so two people never get the same number
--     - self-heals: never returns a number lower than the highest one
--       already used with the current prefix
-- billing_next_number() (used by 074's revert) gets the same logic.
-- Idempotent — safe to run more than once.
-- ============================================================

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
BEGIN
  IF p_kind NOT IN ('quote', 'proforma', 'tax_invoice') THEN
    RAISE EXCEPTION 'Unknown numbering kind %', p_kind USING ERRCODE = '22023';
  END IF;

  INSERT INTO quotation_settings (account_id) VALUES (p_account) ON CONFLICT (account_id) DO NOTHING;

  -- Lock the account's settings row: allocations are serialized.
  SELECT CASE p_kind WHEN 'quote' THEN quote_prefix WHEN 'proforma' THEN proforma_prefix ELSE tax_invoice_prefix END,
         CASE p_kind WHEN 'quote' THEN next_quote_number WHEN 'proforma' THEN next_proforma_number ELSE next_tax_invoice_number END
    INTO v_prefix, v_counter
    FROM quotation_settings
   WHERE account_id = p_account
   FOR UPDATE;

  v_prefix := COALESCE(NULLIF(TRIM(v_prefix), ''),
                       CASE p_kind WHEN 'quote' THEN 'DF-QT-' WHEN 'proforma' THEN 'DF-PI-' ELSE 'DF-TI-' END);

  -- Highest number already used with this prefix (self-heal a lagging counter).
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

-- Callable from the app for the caller's own account.
CREATE OR REPLACE FUNCTION next_document_number(p_kind TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account UUID;
BEGIN
  SELECT account_id INTO v_account FROM profiles WHERE user_id = auth.uid();
  IF v_account IS NULL OR NOT is_account_member(v_account, 'agent') THEN
    RAISE EXCEPTION 'You don''t have permission to create billing documents' USING ERRCODE = '42501';
  END IF;
  RETURN billing_next_number(v_account, p_kind);
END;
$$;

REVOKE ALL ON FUNCTION next_document_number(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION next_document_number(TEXT) TO authenticated;

-- Bring every account's counters up to date right now.
UPDATE quotation_settings s
   SET next_quote_number = GREATEST(s.next_quote_number, COALESCE((
         SELECT MAX(SUBSTR(q.quote_number, LENGTH(s.quote_prefix) + 1)::INT) + 1
           FROM quotations q
          WHERE q.account_id = s.account_id
            AND LEFT(q.quote_number, LENGTH(s.quote_prefix)) = s.quote_prefix
            AND SUBSTR(q.quote_number, LENGTH(s.quote_prefix) + 1) ~ '^[0-9]{1,9}$'), 0)),
       next_proforma_number = GREATEST(s.next_proforma_number, COALESCE((
         SELECT MAX(SUBSTR(i.invoice_number, LENGTH(s.proforma_prefix) + 1)::INT) + 1
           FROM invoices i
          WHERE i.account_id = s.account_id AND i.invoice_type = 'proforma'
            AND LEFT(i.invoice_number, LENGTH(s.proforma_prefix)) = s.proforma_prefix
            AND SUBSTR(i.invoice_number, LENGTH(s.proforma_prefix) + 1) ~ '^[0-9]{1,9}$'), 0)),
       next_tax_invoice_number = GREATEST(s.next_tax_invoice_number, COALESCE((
         SELECT MAX(SUBSTR(i.invoice_number, LENGTH(s.tax_invoice_prefix) + 1)::INT) + 1
           FROM invoices i
          WHERE i.account_id = s.account_id AND i.invoice_type = 'tax_invoice'
            AND LEFT(i.invoice_number, LENGTH(s.tax_invoice_prefix)) = s.tax_invoice_prefix
            AND SUBSTR(i.invoice_number, LENGTH(s.tax_invoice_prefix) + 1) ~ '^[0-9]{1,9}$'), 0));

NOTIFY pgrst, 'reload schema';
