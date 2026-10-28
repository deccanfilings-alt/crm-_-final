-- 065_invoices_and_two_stage_billing.sql
-- Two-stage invoicing: Proforma Invoice (Pre-Payment) & Tax Invoice (Post-Payment / Receipt)

-- 1. Extend quotation_settings with Proforma & Tax Invoice numbering
ALTER TABLE quotation_settings
  ADD COLUMN IF NOT EXISTS proforma_prefix TEXT NOT NULL DEFAULT 'DF-PI-',
  ADD COLUMN IF NOT EXISTS next_proforma_number INT NOT NULL DEFAULT 1001,
  ADD COLUMN IF NOT EXISTS tax_invoice_prefix TEXT NOT NULL DEFAULT 'DF-TI-',
  ADD COLUMN IF NOT EXISTS next_tax_invoice_number INT NOT NULL DEFAULT 1001;

-- 2. Invoices Table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  quotation_id UUID REFERENCES quotations(id) ON DELETE SET NULL,
  
  -- Type: 'proforma' (Pre-payment payment request) or 'tax_invoice' (Post-payment final GST invoice)
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('proforma', 'tax_invoice')),
  invoice_number TEXT NOT NULL,
  title TEXT NOT NULL,
  
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('draft', 'unpaid', 'partially_paid', 'paid', 'cancelled')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  currency TEXT NOT NULL DEFAULT 'INR',
  
  -- Financial calculations
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed', 'none')) DEFAULT 'none',
  discount_value NUMERIC(12,2) DEFAULT 0.00,
  discount_amount NUMERIC(12,2) DEFAULT 0.00,
  tax_type TEXT CHECK (tax_type IN ('gst', 'custom', 'none')) DEFAULT 'gst',
  tax_rate NUMERIC(5,2) DEFAULT 18.00,
  tax_amount NUMERIC(12,2) DEFAULT 0.00,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  
  -- Payment Tracking
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  balance_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  payment_method TEXT CHECK (payment_method IN ('upi', 'bank_transfer', 'card', 'cash', 'cheque', 'other')),
  payment_reference TEXT, -- UTR number / Cheque No / Transaction ID
  payment_notes TEXT,
  paid_at TIMESTAMPTZ,
  
  -- Client Snapshot
  client_name TEXT NOT NULL,
  client_phone TEXT,
  client_email TEXT,
  client_company TEXT,
  client_address TEXT,
  client_gstin TEXT,
  
  -- Company Entity & Signatures Snapshot
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
  
  -- Bank Details Snapshot (used for UPI QR & transfer info)
  bank_name TEXT,
  bank_account_no TEXT,
  bank_ifsc TEXT,
  bank_beneficiary_name TEXT,
  upi_id TEXT,
  upi_qr_url TEXT,
  
  -- Notes & Public Access
  notes TEXT,
  terms TEXT,
  custom_message TEXT,
  pdf_url TEXT,
  public_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  
  -- Timestamps
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique invoice number per account
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_account_invoice_number 
  ON invoices(account_id, invoice_number);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoices_quotation_id ON invoices(quotation_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contact_id ON invoices(contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_deal_id ON invoices(deal_id);
CREATE INDEX IF NOT EXISTS idx_invoices_account_status ON invoices(account_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_account_type ON invoices(account_id, invoice_type);
CREATE INDEX IF NOT EXISTS idx_invoices_public_token ON invoices(public_token);

-- 3. Invoice Line Items
CREATE TABLE IF NOT EXISTS invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  tax_rate NUMERIC(5,2) DEFAULT 0.00,
  total NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id 
  ON invoice_items(invoice_id, position);

-- 4. Row Level Security
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;

-- Account-scoped RLS policies for Invoices
DROP POLICY IF EXISTS "Users can view invoices in their account" ON invoices;
CREATE POLICY "Users can view invoices in their account"
  ON invoices FOR SELECT
  USING (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert invoices in their account" ON invoices;
CREATE POLICY "Users can insert invoices in their account"
  ON invoices FOR INSERT
  WITH CHECK (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can update invoices in their account" ON invoices;
CREATE POLICY "Users can update invoices in their account"
  ON invoices FOR UPDATE
  USING (account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete draft invoices in their account" ON invoices;
CREATE POLICY "Users can delete draft invoices in their account"
  ON invoices FOR DELETE
  USING (
    account_id = (SELECT account_id FROM profiles WHERE user_id = auth.uid())
    AND status = 'draft'
  );

-- Invoice line items RLS
DROP POLICY IF EXISTS "Users can manage invoice_items" ON invoice_items;
CREATE POLICY "Users can manage invoice_items"
  ON invoice_items FOR ALL
  USING (
    invoice_id IN (
      SELECT id FROM invoices WHERE account_id = (
        SELECT account_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  );
