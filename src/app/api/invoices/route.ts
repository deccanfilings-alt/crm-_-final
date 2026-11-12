import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { calculateQuotationTotals } from '@/lib/quotations/calculations';
import { allocateDocumentNumber, isDuplicateNumber } from '@/lib/quotations/next-number';
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
    const invoiceType = url.searchParams.get('type'); // 'proforma' | 'tax_invoice' | 'all'
    const status = url.searchParams.get('status');
    const contactId = url.searchParams.get('contact_id');
    const quotationId = url.searchParams.get('quotation_id');
    const search = url.searchParams.get('search')?.trim();
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

    let query = supabase
      .from('invoices')
      .select('*, items:invoice_items(*)', { count: 'exact' })
      .eq('account_id', profile.account_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (invoiceType && invoiceType !== 'all') {
      query = query.eq('invoice_type', invoiceType);
    }
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    if (contactId) {
      query = query.eq('contact_id', contactId);
    }
    if (quotationId) {
      query = query.eq('quotation_id', quotationId);
    }
    if (search) {
      query = query.or(`invoice_number.ilike.%${search}%,client_name.ilike.%${search}%,title.ilike.%${search}%,payment_reference.ilike.%${search}%`);
    }

    const { data: invoices, count, error } = await query;

    if (error) {
      console.error('[api/invoices] GET query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      invoices: invoices || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('[api/invoices] GET error:', err);
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
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 });
    }
    if (profile.account_role === 'viewer') {
      return NextResponse.json({ error: 'Viewers cannot create invoices' }, { status: 403 });
    }

    const body = await request.json();
    if (body.invoice_type && body.invoice_type !== 'proforma' && body.invoice_type !== 'tax_invoice') {
      return NextResponse.json({ error: 'invoice_type must be proforma or tax_invoice' }, { status: 400 });
    }
    const invoiceType = (body.invoice_type || 'proforma') as 'proforma' | 'tax_invoice';
    if (typeof body.client_name !== 'string' || !body.client_name.trim()) {
      return NextResponse.json({ error: 'Client name is required' }, { status: 400 });
    }
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.some((it: any) => !String(it?.title ?? '').trim())) {
      return NextResponse.json({ error: 'Add at least one line item, each with a title' }, { status: 400 });
    }
    const settings = await getQuotationSettings(supabase, profile.account_id);

    // Numbering: allocated in the database (migration 075) unless given explicitly.
    const manualNumber = typeof body.invoice_number === 'string' && body.invoice_number.trim() ? body.invoice_number.trim() : null;

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const calculated = calculateQuotationTotals({
      items: rawItems,
      discountType: body.discount_type || 'none',
      discountValue: Number(body.discount_value) || 0,
      taxType: body.tax_type || 'gst',
      taxRate: body.tax_rate !== undefined ? Number(body.tax_rate) : (settings.default_tax_rate || 18),
    });

    // A tax invoice is normally raised after payment, so it defaults to paid.
    // Created directly (no quotation/proforma) it may be raised before payment:
    // payment_received: false keeps it unpaid.
    const isPaid = body.status === 'paid' || (invoiceType === 'tax_invoice' && body.payment_received !== false);
    const paidAmount = isPaid
      ? Math.min(calculated.totalAmount, Number(body.paid_amount) || calculated.totalAmount)
      : Math.max(0, Math.min(calculated.totalAmount, Number(body.paid_amount) || 0));
    const balanceAmount = Math.max(0, Math.round((calculated.totalAmount - paidAmount) * 100) / 100);
    const paymentStatus = balanceAmount <= 0.005 ? 'paid' : paidAmount > 0 ? 'partially_paid' : 'unpaid';

    const publicToken = randomBytes(16).toString('hex');

    const insertData: any = {
      account_id: profile.account_id,
      quotation_id: body.quotation_id || null,
      invoice_type: invoiceType,
      invoice_number: manualNumber ?? '',
      title: body.title || (invoiceType === 'proforma' ? 'Proforma Invoice' : 'Tax Invoice'),
      contact_id: body.contact_id || null,
      deal_id: body.deal_id || null,
      conversation_id: body.conversation_id || null,
      created_by_user_id: user.id,
      status: body.status === 'draft' ? 'draft' : paymentStatus,
      issue_date: body.issue_date || new Date().toISOString().slice(0, 10),
      due_date: body.due_date || null,
      currency: body.currency || settings.default_currency || 'INR',

      subtotal: calculated.subtotal,
      discount_type: body.discount_type || 'none',
      discount_value: Number(body.discount_value) || 0,
      discount_amount: calculated.discountAmount,
      tax_type: body.tax_type || 'gst',
      tax_rate: body.tax_rate !== undefined ? Number(body.tax_rate) : (settings.default_tax_rate || 18),
      tax_amount: calculated.taxAmount,
      total_amount: calculated.totalAmount,

      paid_amount: paidAmount,
      balance_amount: balanceAmount,
      payment_method: paidAmount > 0 ? (body.payment_method || 'upi') : null,
      payment_reference: body.payment_reference || null,
      payment_notes: body.payment_notes || null,
      paid_at: paidAmount > 0 ? (body.paid_at || new Date().toISOString()) : null,

      client_name: body.client_name,
      client_phone: body.client_phone || null,
      client_email: body.client_email || null,
      client_company: body.client_company || null,
      client_address: body.client_address || null,
      client_gstin: body.client_gstin || null,

      company_name: body.company_name || settings.company_name,
      company_logo_url: body.company_logo_url || settings.company_logo_url,
      company_address: body.company_address || settings.company_address,
      company_phone: body.company_phone || settings.company_phone,
      company_email: body.company_email || settings.company_email,
      company_website: body.company_website || settings.company_website,
      gstin: body.gstin || settings.gstin,
      pan: body.pan || settings.pan,
      signature_url: body.signature_url || settings.signature_url,
      stamp_url: body.stamp_url || settings.stamp_url,

      bank_name: settings.bank_name,
      bank_account_no: settings.bank_account_no,
      bank_ifsc: settings.bank_ifsc,
      bank_beneficiary_name: settings.bank_beneficiary_name,
      upi_id: settings.upi_id,
      upi_qr_url: settings.upi_qr_url,

      notes: body.notes || null,
      terms: body.terms || settings.default_terms || null,
      custom_message: body.custom_message || null,
      public_token: publicToken,
    };

    insertData.invoice_number = manualNumber ?? (await allocateDocumentNumber(supabase, profile.account_id, invoiceType, settings));
    let { data: invoice, error: insertError } = await supabase
      .from('invoices')
      .insert(insertData)
      .select()
      .single();
    for (let attempt = 0; attempt < 3 && !manualNumber && isDuplicateNumber(insertError); attempt++) {
      insertData.invoice_number = await allocateDocumentNumber(supabase, profile.account_id, invoiceType, settings);
      ({ data: invoice, error: insertError } = await supabase
        .from('invoices')
        .insert(insertData)
        .select()
        .single());
    }

    if (insertError) {
      console.error('[api/invoices] POST insert error:', insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Insert line items
    if (rawItems.length > 0) {
      const itemsToInsert = rawItems.map((it: any, idx: number) => ({
        invoice_id: invoice.id,
        position: idx,
        title: it.title,
        description: it.description || null,
        quantity: Number(it.quantity) || 1,
        unit_price: Number(it.unit_price) || 0,
        tax_rate: it.tax_rate !== undefined ? Number(it.tax_rate) : (Number(body.tax_rate) || 18),
        total: calculated.itemTotals[idx] !== undefined ? calculated.itemTotals[idx] : (Number(it.quantity) || 1) * (Number(it.unit_price) || 0),
      }));

      const { error: itemsErr } = await supabase
        .from('invoice_items')
        .insert(itemsToInsert);

      if (itemsErr) {
        // Don't leave an invoice with no lines (and a burnt number) behind.
        console.error('[api/invoices] Items insert error:', itemsErr);
        // RLS only allows deleting drafts, so flip it to draft first.
        await supabase.from('invoices').update({ status: 'draft' }).eq('id', invoice.id);
        await supabase.from('invoices').delete().eq('id', invoice.id);
        return NextResponse.json({ error: 'Could not save the line items — please try again' }, { status: 500 });
      }
    }

    const { data: completeInvoice } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', invoice.id)
      .single();

    return NextResponse.json({ invoice: completeInvoice || invoice }, { status: 201 });
  } catch (err: any) {
    console.error('[api/invoices] POST error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
