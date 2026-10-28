import { describe, it, expect } from 'vitest';
import { formatInvoiceNumber } from '@/lib/quotations/numbering';
import { renderInvoiceHtml } from '@/lib/invoices/invoice-template';
import type { Invoice, QuotationSettings } from '@/types';

describe('2-Stage Invoicing System', () => {
  const mockSettings: QuotationSettings = {
    account_id: '00000000-0000-0000-0000-000000000001',
    company_name: 'Deccan Filings',
    company_logo_url: 'https://example.com/logo.png',
    company_address: 'Hyderabad, Telangana',
    company_phone: '+91 99999 99999',
    company_email: 'support@deccanfilings.com',
    company_website: 'https://deccanfilings.com',
    gstin: '36AAKCT1792MIZO',
    pan: 'AAKCT1792M',
    bank_name: 'ICICI Bank',
    bank_account_no: '236305002126',
    bank_ifsc: 'ICIC0002363',
    bank_beneficiary_name: 'TOR Business Solutions Pvt Ltd',
    upi_id: 'payment@icici',
    upi_qr_url: 'https://example.com/qr.png',
    signature_url: 'https://example.com/signature.png',
    stamp_url: 'https://example.com/seal.png',
    default_terms: 'Payment due on receipt.',
    quote_prefix: 'DF-QT-',
    next_quote_number: 1001,
    proforma_prefix: 'DF-PI-',
    next_proforma_number: 1001,
    tax_invoice_prefix: 'DF-TI-',
    next_tax_invoice_number: 1001,
    default_currency: 'INR',
    default_tax_rate: 18.0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  it('formats proforma and tax invoice numbers correctly', () => {
    expect(formatInvoiceNumber('DF-PI-', 1001, 'proforma')).toBe('DF-PI-1001');
    expect(formatInvoiceNumber('DF-TI-', 1001, 'tax_invoice')).toBe('DF-TI-1001');
    expect(formatInvoiceNumber('', 5, 'proforma')).toBe('DF-PI-0005');
    expect(formatInvoiceNumber('', 5, 'tax_invoice')).toBe('DF-TI-0005');
  });

  it('renders Proforma Invoice HTML with UPI QR, Bank details, and official credentials', () => {
    const proforma: Invoice = {
      id: 'inv-1',
      account_id: mockSettings.account_id,
      invoice_type: 'proforma',
      invoice_number: 'DF-PI-1001',
      title: 'Company Registration Service',
      status: 'unpaid',
      issue_date: '2026-10-28',
      currency: 'INR',
      subtotal: 5000,
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      tax_type: 'gst',
      tax_rate: 18,
      tax_amount: 900,
      total_amount: 5900,
      paid_amount: 0,
      balance_amount: 5900,
      client_name: 'Ramesh Sharma',
      public_token: 'tok-proforma-123',
      created_at: '2026-10-28T00:00:00Z',
      updated_at: '2026-10-28T00:00:00Z',
      items: [
        {
          id: 'item-1',
          invoice_id: 'inv-1',
          position: 0,
          title: 'Pvt Ltd Incorporation',
          quantity: 1,
          unit_price: 5000,
          tax_rate: 18,
          total: 5900,
        },
      ],
    };

    const html = renderInvoiceHtml(proforma, mockSettings);

    expect(html).toContain('PROFORMA INVOICE');
    expect(html).toContain('DF-PI-1001');
    expect(html).toContain('ICICI Bank');
    expect(html).toContain('236305002126');
    expect(html).toContain('https://example.com/signature.png');
    expect(html).toContain('https://example.com/seal.png');
    expect(html).not.toContain('PAID');
  });

  it('renders Tax Invoice HTML with prominent PAID badge, UTR, and GST declaration', () => {
    const taxInvoice: Invoice = {
      id: 'inv-2',
      account_id: mockSettings.account_id,
      invoice_type: 'tax_invoice',
      invoice_number: 'DF-TI-1001',
      title: 'Company Registration Service',
      status: 'paid',
      issue_date: '2026-10-28',
      currency: 'INR',
      subtotal: 5000,
      discount_type: 'none',
      discount_value: 0,
      discount_amount: 0,
      tax_type: 'gst',
      tax_rate: 18,
      tax_amount: 900,
      total_amount: 5900,
      paid_amount: 5900,
      balance_amount: 0,
      payment_method: 'upi',
      payment_reference: 'UTR428910293812',
      paid_at: '2026-10-28T14:30:00Z',
      client_name: 'Ramesh Sharma',
      public_token: 'tok-tax-123',
      created_at: '2026-10-28T00:00:00Z',
      updated_at: '2026-10-28T00:00:00Z',
      items: [
        {
          id: 'item-1',
          invoice_id: 'inv-2',
          position: 0,
          title: 'Pvt Ltd Incorporation',
          quantity: 1,
          unit_price: 5000,
          tax_rate: 18,
          total: 5900,
        },
      ],
    };

    const html = renderInvoiceHtml(taxInvoice, mockSettings);

    expect(html).toContain('TAX INVOICE');
    expect(html).toContain('DF-TI-1001');
    expect(html).toContain('PAID');
    expect(html).toContain('UTR428910293812');
    expect(html).toContain('Payment Receipt Acknowledgement');
    expect(html).toContain('Balance Due :');
    expect(html).toContain('INR 0.00');
    expect(html).toContain('Certified that the particulars given above are true and correct');
  });
});
