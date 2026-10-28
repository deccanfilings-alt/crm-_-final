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

    return NextResponse.json({ invoice, settings });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
