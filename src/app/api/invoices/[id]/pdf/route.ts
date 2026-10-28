import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { renderInvoiceHtml } from '@/lib/invoices/invoice-template';
import { getQuotationSettings } from '@/lib/quotations/settings';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const admin = supabaseAdmin();

    const { data: invoice, error } = await admin
      .from('invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', id)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (Array.isArray(invoice.items)) {
      invoice.items.sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
    }

    const settings = await getQuotationSettings(admin, invoice.account_id);
    const html = renderInvoiceHtml(invoice, settings);

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${invoice.invoice_number}.html"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
