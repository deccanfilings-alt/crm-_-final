import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { getQuotationSettings } from '@/lib/quotations/settings';
import { formatInvoiceNumber } from '@/lib/quotations/numbering';

export async function POST(
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

    const body = await request.json();
    const invoiceType = (body.invoice_type || 'proforma') as 'proforma' | 'tax_invoice';

    // Fetch the quotation with items
    const { data: quote, error: quoteErr } = await supabase
      .from('quotations')
      .select('*, items:quotation_items(*)')
      .eq('id', id)
      .single();

    if (quoteErr || !quote) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    const settings = await getQuotationSettings(supabase, quote.account_id);
    const nextNum = invoiceType === 'proforma' ? (settings.next_proforma_number || 1001) : (settings.next_tax_invoice_number || 1001);
    const prefix = invoiceType === 'proforma' ? (settings.proforma_prefix || 'DF-PI-') : (settings.tax_invoice_prefix || 'DF-TI-');
    const invoiceNumber = formatInvoiceNumber(prefix, nextNum, invoiceType);

    const isPaid = invoiceType === 'tax_invoice' || body.status === 'paid';
    const paidAmount = isPaid ? quote.total_amount : 0;
    const balanceAmount = Math.max(0, quote.total_amount - paidAmount);

    const invoicePayload: any = {
      account_id: quote.account_id,
      quotation_id: quote.id,
      invoice_type: invoiceType,
      invoice_number: invoiceNumber,
      title: body.title || `${invoiceType === 'proforma' ? 'Proforma Invoice' : 'Tax Invoice'} - ${quote.title}`,
      contact_id: quote.contact_id,
      deal_id: quote.deal_id,
      conversation_id: quote.conversation_id,
      created_by_user_id: user.id,
      status: isPaid ? 'paid' : 'unpaid',
      issue_date: new Date().toISOString().slice(0, 10),
      currency: quote.currency || 'INR',

      subtotal: quote.subtotal,
      discount_type: quote.discount_type,
      discount_value: quote.discount_value,
      discount_amount: quote.discount_amount,
      tax_type: quote.tax_type,
      tax_rate: quote.tax_rate,
      tax_amount: quote.tax_amount,
      total_amount: quote.total_amount,

      paid_amount: paidAmount,
      balance_amount: balanceAmount,
      payment_method: body.payment_method || (isPaid ? 'upi' : null),
      payment_reference: body.payment_reference || null,
      paid_at: isPaid ? new Date().toISOString() : null,

      client_name: quote.client_name,
      client_phone: quote.client_phone,
      client_email: quote.client_email,
      client_company: quote.client_company,
      client_address: quote.client_address,
      client_gstin: quote.client_gstin,

      company_name: quote.company_name || settings.company_name,
      company_logo_url: quote.company_logo_url || settings.company_logo_url,
      company_address: quote.company_address || settings.company_address,
      company_phone: quote.company_phone || settings.company_phone,
      company_email: quote.company_email || settings.company_email,
      company_website: quote.company_website || settings.company_website,
      gstin: quote.gstin || settings.gstin,
      pan: quote.pan || settings.pan,
      signature_url: quote.signature_url || settings.signature_url,
      stamp_url: quote.stamp_url || settings.stamp_url,

      bank_name: settings.bank_name,
      bank_account_no: settings.bank_account_no,
      bank_ifsc: settings.bank_ifsc,
      bank_beneficiary_name: settings.bank_beneficiary_name,
      upi_id: settings.upi_id,
      upi_qr_url: settings.upi_qr_url,

      notes: quote.notes,
      terms: quote.terms || settings.default_terms,
      custom_message: quote.custom_message,
      public_token: randomBytes(16).toString('hex'),
    };

    const { data: newInvoice, error: invErr } = await supabase
      .from('invoices')
      .insert(invoicePayload)
      .select()
      .single();

    if (invErr) {
      console.error('[convert-to-invoice] insert error:', invErr);
      return NextResponse.json({ error: invErr.message }, { status: 500 });
    }

    // Copy line items
    if (Array.isArray(quote.items) && quote.items.length > 0) {
      const itemsToInsert = quote.items.map((it: any, idx: number) => ({
        invoice_id: newInvoice.id,
        position: idx,
        title: it.title,
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        tax_rate: it.tax_rate,
        total: it.total,
      }));
      await supabase.from('invoice_items').insert(itemsToInsert);
    }

    // Mark quotation as accepted
    if (quote.status !== 'accepted') {
      await supabase
        .from('quotations')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', quote.id);
    }

    // Increment running sequence
    const updateField = invoiceType === 'proforma' ? 'next_proforma_number' : 'next_tax_invoice_number';
    await supabase
      .from('quotation_settings')
      .update({
        [updateField]: nextNum + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', quote.account_id);

    const { data: complete } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', newInvoice.id)
      .single();

    return NextResponse.json({ success: true, invoice: complete || newInvoice });
  } catch (err: any) {
    console.error('[convert-to-invoice] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
