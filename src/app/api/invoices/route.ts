import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { calculateQuotationTotals } from '@/lib/quotations/calculations';
import { formatInvoiceNumber } from '@/lib/quotations/numbering';
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
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 });
    }

    const body = await request.json();
    const invoiceType = (body.invoice_type || 'proforma') as 'proforma' | 'tax_invoice';
    const settings = await getQuotationSettings(supabase, profile.account_id);

    // Numbering resolution
    let invoiceNumber = body.invoice_number;
    const nextNum = invoiceType === 'proforma' ? (settings.next_proforma_number || 1001) : (settings.next_tax_invoice_number || 1001);
    const prefix = invoiceType === 'proforma' ? (settings.proforma_prefix || 'DF-PI-') : (settings.tax_invoice_prefix || 'DF-TI-');

    if (!invoiceNumber) {
      invoiceNumber = formatInvoiceNumber(prefix, nextNum, invoiceType);
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const calculated = calculateQuotationTotals({
      items: rawItems,
      discountType: body.discount_type || 'none',
      discountValue: Number(body.discount_value) || 0,
      taxType: body.tax_type || 'gst',
      taxRate: body.tax_rate !== undefined ? Number(body.tax_rate) : (settings.default_tax_rate || 18),
    });

    const isPaid = body.status === 'paid' || invoiceType === 'tax_invoice';
    const paidAmount = isPaid ? (Number(body.paid_amount) || calculated.totalAmount) : (Number(body.paid_amount) || 0);
    const balanceAmount = Math.max(0, calculated.totalAmount - paidAmount);

    const publicToken = randomBytes(16).toString('hex');

    const insertData: any = {
      account_id: profile.account_id,
      quotation_id: body.quotation_id || null,
      invoice_type: invoiceType,
      invoice_number: invoiceNumber,
      title: body.title || (invoiceType === 'proforma' ? 'Proforma Invoice' : 'Tax Invoice'),
      contact_id: body.contact_id || null,
      deal_id: body.deal_id || null,
      conversation_id: body.conversation_id || null,
      created_by_user_id: user.id,
      status: body.status || (isPaid ? 'paid' : 'unpaid'),
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
      payment_method: body.payment_method || (isPaid ? 'upi' : null),
      payment_reference: body.payment_reference || null,
      payment_notes: body.payment_notes || null,
      paid_at: isPaid ? (body.paid_at || new Date().toISOString()) : null,

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

    const { data: invoice, error: insertError } = await supabase
      .from('invoices')
      .insert(insertData)
      .select()
      .single();

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
        console.error('[api/invoices] Items insert error:', itemsErr);
      }
    }

    // Increment running sequence in settings
    try {
      const updateField = invoiceType === 'proforma' ? 'next_proforma_number' : 'next_tax_invoice_number';
      await supabase
        .from('quotation_settings')
        .update({
          [updateField]: nextNum + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', profile.account_id);
    } catch (seqErr) {
      console.warn('[api/invoices] Sequence increment warning:', seqErr);
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
