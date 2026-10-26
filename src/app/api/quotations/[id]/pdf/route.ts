import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getQuotationSettings } from '@/lib/quotations/settings';
import { renderQuotationHtml } from '@/lib/quotations/quotation-template';

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

    const { data: quote, error: quoteError } = await supabase
      .from('quotations')
      .select('*, items:quotation_items(*)')
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    const settings = await getQuotationSettings(supabase, profile.account_id);
    const html = renderQuotationHtml(quote, settings);

    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (err: any) {
    console.error('[api/quotations/[id]/pdf] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
