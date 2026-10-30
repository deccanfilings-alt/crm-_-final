import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { getQuotationSettings } from '@/lib/quotations/settings';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const admin = supabaseAdmin();

    const { data: invoice, error } = await admin
      .from('invoices')
      .select('*, items:invoice_items(*)')
      .eq('public_token', token)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (Array.isArray(invoice.items)) {
      invoice.items.sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
    }

    const settings = await getQuotationSettings(admin, invoice.account_id);

    // Omit sensitive/internal columns
    const {
      account_id: _aid,
      created_by_user_id: _cbuid,
      contact_id: _cid,
      deal_id: _did,
      conversation_id: _convid,
      payment_notes: _pn,
      ...safeInvoice
    } = invoice;

    const safeSettings = {
      company_name: settings.company_name,
      company_address: settings.company_address,
      company_phone: settings.company_phone,
      company_email: settings.company_email,
      company_website: settings.company_website,
      company_logo_url: settings.company_logo_url,
      gstin: settings.gstin,
      pan: settings.pan,
      bank_name: settings.bank_name,
      bank_account_no: settings.bank_account_no,
      bank_ifsc: settings.bank_ifsc,
      bank_beneficiary_name: settings.bank_beneficiary_name,
      upi_id: settings.upi_id,
      upi_qr_url: settings.upi_qr_url,
      stamp_url: settings.stamp_url,
      signature_url: settings.signature_url,
      default_terms: settings.default_terms,
    };

    return NextResponse.json({ invoice: safeInvoice, settings: safeSettings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
