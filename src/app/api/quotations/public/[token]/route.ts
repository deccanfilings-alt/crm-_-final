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

    const { data: quote, error } = await admin
      .from('quotations')
      .select('*, items:quotation_items(*)')
      .eq('public_token', token)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    if (Array.isArray(quote.items)) {
      quote.items.sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
    }

    const settings = await getQuotationSettings(admin, quote.account_id);

    // Omit sensitive/internal columns
    const {
      account_id: _aid,
      created_by_user_id: _cbuid,
      contact_id: _cid,
      deal_id: _did,
      conversation_id: _convid,
      ...safeQuote
    } = quote;

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

    return NextResponse.json({ quotation: safeQuote, settings: safeSettings });
  } catch (err: any) {
    console.error('[api/quotations/public] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
