import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { calculateQuotationTotals } from '@/lib/quotations/calculations';
import { formatQuoteNumber } from '@/lib/quotations/numbering';
import { getQuotationSettings } from '@/lib/quotations/settings';

export async function GET(request: Request) {
  try {
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

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const contactId = url.searchParams.get('contact_id');
    const dealId = url.searchParams.get('deal_id');
    const search = url.searchParams.get('search')?.trim();
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

    let query = supabase
      .from('quotations')
      .select('*, items:quotation_items(*)', { count: 'exact' })
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    if (contactId) {
      query = query.eq('contact_id', contactId);
    }
    if (dealId) {
      query = query.eq('deal_id', dealId);
    }
    if (search) {
      query = query.or(`quote_number.ilike.%${search}%,client_name.ilike.%${search}%,title.ilike.%${search}%`);
    }

    const { data: quotations, count, error } = await query;

    if (error) {
      console.error('[api/quotations] GET query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      quotations: quotations || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('[api/quotations] GET error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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

    const body = await request.json();
    const {
      title,
      contact_id,
      deal_id,
      conversation_id,
      client_name,
      client_phone,
      client_email,
      client_company,
      client_address,
      client_gstin,
      issue_date,
      valid_until,
      currency,
      discount_type,
      discount_value,
      tax_type,
      tax_rate,
      notes,
      terms,
      items,
    } = body;

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Quotation title is required' }, { status: 400 });
    }
    if (!client_name?.trim()) {
      return NextResponse.json({ error: 'Client name is required' }, { status: 400 });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 });
    }

    // Server-side calculation of totals
    const totals = calculateQuotationTotals({
      items,
      discountType: discount_type,
      discountValue: discount_value,
      taxType: tax_type,
      taxRate: tax_rate,
    });

    // Fetch quotation settings to determine quote number
    const settings = await getQuotationSettings(supabase, profile.account_id);
    const quoteNumber = formatQuoteNumber(settings.quote_prefix, settings.next_quote_number);

    // Increment next_quote_number in settings
    await supabase
      .from('quotation_settings')
      .upsert({
        account_id: profile.account_id,
        quote_prefix: settings.quote_prefix,
        next_quote_number: settings.next_quote_number + 1,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id' });

    const publicToken = randomBytes(16).toString('hex');

    const quotationPayload = {
      account_id: profile.account_id,
      quote_number: quoteNumber,
      title: title.trim(),
      contact_id: contact_id || null,
      deal_id: deal_id || null,
      conversation_id: conversation_id || null,
      created_by_user_id: user.id,
      status: 'draft',
      issue_date: issue_date || new Date().toISOString().split('T')[0],
      valid_until: valid_until || null,
      currency: currency || settings.default_currency || 'INR',
      subtotal: totals.subtotal,
      discount_type: discount_type || 'none',
      discount_value: discount_value || 0,
      discount_amount: totals.discountAmount,
      tax_type: tax_type || 'gst',
      tax_rate: tax_rate !== undefined ? tax_rate : settings.default_tax_rate,
      tax_amount: totals.taxAmount,
      total_amount: totals.totalAmount,
      client_name: client_name.trim(),
      client_phone: client_phone?.trim() || null,
      client_email: client_email?.trim() || null,
      client_company: client_company?.trim() || null,
      client_address: client_address?.trim() || null,
      client_gstin: client_gstin?.trim() || null,
      notes: notes || null,
      terms: terms !== undefined ? terms : settings.default_terms,
      public_token: publicToken,
    };

    const { data: createdQuote, error: quoteError } = await supabase
      .from('quotations')
      .insert(quotationPayload)
      .select()
      .single();

    if (quoteError) {
      console.error('[api/quotations] insert quotation error:', quoteError);
      return NextResponse.json({ error: quoteError.message }, { status: 500 });
    }

    // Insert items
    const lineItemRows = items.map((item: any, idx: number) => ({
      quotation_id: createdQuote.id,
      position: idx,
      title: item.title?.trim() || `Item ${idx + 1}`,
      description: item.description?.trim() || null,
      quantity: Math.max(0, item.quantity || 1),
      unit_price: Math.max(0, item.unit_price || 0),
      tax_rate: item.tax_rate !== undefined ? item.tax_rate : 0,
      total: totals.itemTotals[idx] || 0,
    }));

    const { data: insertedItems, error: itemsError } = await supabase
      .from('quotation_items')
      .insert(lineItemRows)
      .select();

    if (itemsError) {
      console.error('[api/quotations] insert items error:', itemsError);
    }

    return NextResponse.json({
      success: true,
      quotation: {
        ...createdQuote,
        items: insertedItems || [],
      },
    });
  } catch (err: any) {
    console.error('[api/quotations] POST error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
