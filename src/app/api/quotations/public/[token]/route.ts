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

    return NextResponse.json({ quotation: quote, settings });
  } catch (err: any) {
    console.error('[api/quotations/public] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
