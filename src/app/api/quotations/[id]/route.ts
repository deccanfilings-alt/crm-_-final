import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { calculateQuotationTotals } from '@/lib/quotations/calculations';

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

    const { data: quote, error } = await supabase
      .from('quotations')
      .select('*, items:quotation_items(*), contact:contacts(*), deal:deals(*)')
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    // Sort items by position
    if (Array.isArray(quote.items)) {
      quote.items.sort((a: any, b: any) => (a.position || 0) - (b.position || 0));
    }

    return NextResponse.json({ quotation: quote });
  } catch (err: any) {
    console.error('[api/quotations/[id]] GET error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
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

    // Check existing quotation
    const { data: existing, error: fetchErr } = await supabase
      .from('quotations')
      .select('*')
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    const body = await request.json();
    const {
      title,
      client_name,
      client_phone,
      client_email,
      client_company,
      client_address,
      client_gstin,
      valid_until,
      discount_type,
      discount_value,
      tax_type,
      tax_rate,
      notes,
      terms,
      items,
      company_name,
      company_logo_url,
      company_address,
      company_phone,
      company_email,
      company_website,
      gstin,
      pan,
      signature_url,
      stamp_url,
    } = body;

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (title !== undefined) updates.title = title.trim();
    if (client_name !== undefined) updates.client_name = client_name.trim();
    if (client_phone !== undefined) updates.client_phone = client_phone?.trim() || null;
    if (client_email !== undefined) updates.client_email = client_email?.trim() || null;
    if (client_company !== undefined) updates.client_company = client_company?.trim() || null;
    if (client_address !== undefined) updates.client_address = client_address?.trim() || null;
    if (client_gstin !== undefined) updates.client_gstin = client_gstin?.trim() || null;
    if (valid_until !== undefined) updates.valid_until = valid_until || null;
    if (notes !== undefined) updates.notes = notes || null;
    if (terms !== undefined) updates.terms = terms || null;
    if (company_name !== undefined) updates.company_name = company_name?.trim() || null;
    if (company_logo_url !== undefined) updates.company_logo_url = company_logo_url?.trim() || null;
    if (company_address !== undefined) updates.company_address = company_address?.trim() || null;
    if (company_phone !== undefined) updates.company_phone = company_phone?.trim() || null;
    if (company_email !== undefined) updates.company_email = company_email?.trim() || null;
    if (company_website !== undefined) updates.company_website = company_website?.trim() || null;
    if (gstin !== undefined) updates.gstin = gstin?.trim() || null;
    if (pan !== undefined) updates.pan = pan?.trim() || null;
    if (signature_url !== undefined) updates.signature_url = signature_url?.trim() || null;
    if (stamp_url !== undefined) updates.stamp_url = stamp_url?.trim() || null;

    if (Array.isArray(items)) {
      const totals = calculateQuotationTotals({
        items,
        discountType: discount_type !== undefined ? discount_type : existing.discount_type,
        discountValue: discount_value !== undefined ? discount_value : existing.discount_value,
        taxType: tax_type !== undefined ? tax_type : existing.tax_type,
        taxRate: tax_rate !== undefined ? tax_rate : existing.tax_rate,
      });

      updates.subtotal = totals.subtotal;
      updates.discount_amount = totals.discountAmount;
      updates.tax_amount = totals.taxAmount;
      updates.total_amount = totals.totalAmount;
      if (discount_type !== undefined) updates.discount_type = discount_type;
      if (discount_value !== undefined) updates.discount_value = discount_value;
      if (tax_type !== undefined) updates.tax_type = tax_type;
      if (tax_rate !== undefined) updates.tax_rate = tax_rate;

      // Re-insert line items
      await supabase.from('quotation_items').delete().eq('quotation_id', id);

      const itemRows = items.map((it: any, idx: number) => ({
        quotation_id: id,
        position: idx,
        title: it.title?.trim() || `Item ${idx + 1}`,
        description: it.description?.trim() || null,
        quantity: Math.max(0, it.quantity || 1),
        unit_price: Math.max(0, it.unit_price || 0),
        tax_rate: it.tax_rate !== undefined ? it.tax_rate : 0,
        total: totals.itemTotals[idx] || 0,
      }));

      await supabase.from('quotation_items').insert(itemRows);
    }

    const { data: updated, error: updateErr } = await supabase
      .from('quotations')
      .update(updates)
      .eq('id', id)
      .select('*, items:quotation_items(*)')
      .single();

    if (updateErr) {
      console.error('[api/quotations/[id]] PATCH error:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, quotation: updated });
  } catch (err: any) {
    console.error('[api/quotations/[id]] PATCH error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
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
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 });
    }

    const { error } = await supabase
      .from('quotations')
      .delete()
      .eq('id', id)
      .eq('account_id', profile.account_id);

    if (error) {
      console.error('[api/quotations/[id]] DELETE error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[api/quotations/[id]] DELETE error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
