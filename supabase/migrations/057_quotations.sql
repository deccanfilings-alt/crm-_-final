-- 057_quotations.sql — Quotations and Invoicing foundation
-- Adds native Quotations, Line Items, and Account Quotation/Company Settings.

-- 1. Company / Account Quotation Settings
CREATE TABLE IF NOT EXISTS quotation_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL DEFAULT 'Deccan Filings',
  company_logo_url TEXT,
  company_address TEXT,
  company_phone TEXT,
  company_email TEXT,
  company_website TEXT,
  gstin TEXT,
  pan TEXT,
  bank_name TEXT,
  bank_account_no TEXT,
  bank_ifsc TEXT,
  bank_beneficiary_name TEXT,
  upi_id TEXT,
  upi_qr_url TEXT,
  signature_url TEXT,
  stamp_url TEXT,
  default_terms TEXT DEFAULT '1. Quotation valid for 15 days.
2. 50% advance before project commencement.
3. Delivery timelines commence post document completion.',
  quote_prefix TEXT NOT NULL DEFAULT 'DF-QT-',
  next_quote_number INT NOT NULL DEFAULT 1001,
  default_currency TEXT NOT NULL DEFAULT 'INR',
  default_tax_rate NUMERIC(5,2) NOT NULL DEFAULT 18.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Quotations Table
CREATE TABLE IF NOT EXISTS quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  quote_number TEXT NOT NULL,
  title TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  currency TEXT NOT NULL DEFAULT 'INR',
  
  -- Calculations
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed', 'none')) DEFAULT 'none',
  discount_value NUMERIC(12,2) DEFAULT 0.00,
  discount_amount NUMERIC(12,2) DEFAULT 0.00,
  tax_type TEXT CHECK (tax_type IN ('gst', 'custom', 'none')) DEFAULT 'gst',
  tax_rate NUMERIC(5,2) DEFAULT 18.00,
  tax_amount NUMERIC(12,2) DEFAULT 0.00,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  
  -- Client & Snapshot Data
  client_name TEXT NOT NULL,
  client_phone TEXT,
  client_email TEXT,
  client_company TEXT,
  client_address TEXT,
  client_gstin TEXT,

  -- Dynamic Issuing Entity & Signatures
  company_name TEXT,
  company_logo_url TEXT,
  company_address TEXT,
  company_phone TEXT,
  company_email TEXT,
  company_website TEXT,
  gstin TEXT,
  pan TEXT,
  signature_url TEXT,
  stamp_url TEXT,
  
  -- Meta & Notes
  notes TEXT,
  terms TEXT,
  custom_message TEXT,
  pdf_url TEXT,
  public_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  
  -- Timestamps
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique quotation number per account
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_account_quote_number 
  ON quotations(account_id, quote_number);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_quotations_contact_id ON quotations(contact_id);
CREATE INDEX IF NOT EXISTS idx_quotations_deal_id ON quotations(deal_id);
CREATE INDEX IF NOT EXISTS idx_quotations_account_status ON quotations(account_id, status);
CREATE INDEX IF NOT EXISTS idx_quotations_public_token ON quotations(public_token);

-- 3. Quotation Line Items
CREATE TABLE IF NOT EXISTS quotation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  tax_rate NUMERIC(5,2) DEFAULT 0.00,
  total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id 
  ON quotation_items(quotation_id, position);

-- 4. Row Level Security
ALTER TABLE quotation_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_items ENABLE ROW LEVEL SECURITY;

-- Account-scoped RLS policies
DROP POLICY IF EXISTS "Users can read own account quotation_settings" ON quotation_settings;
CREATE POLICY "Users can read own account quotation_settings"
  ON quotation_settings FOR SELECT
  USING (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins and owners can update quotation_settings" ON quotation_settings;
CREATE POLICY "Admins and owners can update quotation_settings"
  ON quotation_settings FOR ALL
  USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND (SELECT account_role FROM profiles WHERE user_id = auth.uid()) IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS "Users can view quotations in their account" ON quotations;
CREATE POLICY "Users can view quotations in their account"
  ON quotations FOR SELECT
  USING (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert quotations in their account" ON quotations;
CREATE POLICY "Users can insert quotations in their account"
  ON quotations FOR INSERT
  WITH CHECK (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update quotations in their account" ON quotations;
CREATE POLICY "Users can update quotations in their account"
  ON quotations FOR UPDATE
  USING (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete draft quotations in their account" ON quotations;
CREATE POLICY "Users can delete draft quotations in their account"
  ON quotations FOR DELETE
  USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND status = 'draft'
  );

DROP POLICY IF EXISTS "Users can manage quotation_items" ON quotation_items;
CREATE POLICY "Users can manage quotation_items"
  ON quotation_items FOR ALL
  USING (
    quotation_id IN (
      SELECT id FROM quotations WHERE account_id = (
        SELECT account_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  );
