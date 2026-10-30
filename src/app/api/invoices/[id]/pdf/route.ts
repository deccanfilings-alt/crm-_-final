import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderInvoiceHtml } from '@/lib/invoices/invoice-template';
import { getQuotationSettings } from '@/lib/quotations/settings';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 });
    }

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (Array.isArray(invoice.items)) {
      invoice.items.sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
    }

    const settings = await getQuotationSettings(supabase, profile.account_id);
    const html = renderInvoiceHtml(invoice, settings);

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${invoice.invoice_number}.html"`,
      },
    });
  } catch (err: any) {
    console.error('[api/invoices/[id]/pdf] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
