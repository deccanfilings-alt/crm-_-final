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
    const paymentMethod = body.payment_method || 'upi';
    const paymentReference = body.payment_reference || '';
    const paymentNotes = body.payment_notes || '';
    const paidAt = body.paid_at || new Date().toISOString();

    // Fetch the target invoice
    const { data: invoice, error: fetchErr } = await supabase
      .from('invoices')
      .select('*, items:invoice_items(*)')
      .eq('id', id)
      .single();

    if (fetchErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const amountPaid = Number(body.paid_amount) || invoice.total_amount;
    const remainingBalance = Math.max(0, invoice.total_amount - amountPaid);
    const newStatus = remainingBalance === 0 ? 'paid' : 'partially_paid';

    // 1. Mark existing invoice as paid
    const { data: updatedOriginal, error: updateErr } = await supabase
      .from('invoices')
      .update({
        status: newStatus,
        paid_amount: amountPaid,
        balance_amount: remainingBalance,
        payment_method: paymentMethod,
        payment_reference: paymentReference,
        payment_notes: paymentNotes,
        paid_at: paidAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*, items:invoice_items(*)')
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 2. If this was a Proforma Invoice, generate the corresponding official Tax Invoice (DF-TI-...)
    let taxInvoice = null;
    if (invoice.invoice_type === 'proforma') {
      const settings = await getQuotationSettings(supabase, invoice.account_id);
      const nextNum = settings.next_tax_invoice_number || 1001;
      const prefix = settings.tax_invoice_prefix || 'DF-TI-';
      const taxInvoiceNumber = formatInvoiceNumber(prefix, nextNum, 'tax_invoice');

      const taxInvoicePayload: any = {
        account_id: invoice.account_id,
        quotation_id: invoice.quotation_id || null,
        invoice_type: 'tax_invoice',
        invoice_number: taxInvoiceNumber,
        title: `Tax Invoice for ${invoice.client_company || invoice.client_name}`,
        contact_id: invoice.contact_id,
        deal_id: invoice.deal_id,
        conversation_id: invoice.conversation_id,
        created_by_user_id: user.id,
        status: 'paid',
        issue_date: new Date().toISOString().slice(0, 10),
        currency: invoice.currency,

        subtotal: invoice.subtotal,
        discount_type: invoice.discount_type,
        discount_value: invoice.discount_value,
        discount_amount: invoice.discount_amount,
        tax_type: invoice.tax_type,
        tax_rate: invoice.tax_rate,
        tax_amount: invoice.tax_amount,
        total_amount: invoice.total_amount,

        paid_amount: amountPaid,
        balance_amount: remainingBalance,
        payment_method: paymentMethod,
        payment_reference: paymentReference,
        payment_notes: paymentNotes,
        paid_at: paidAt,

        client_name: invoice.client_name,
        client_phone: invoice.client_phone,
        client_email: invoice.client_email,
        client_company: invoice.client_company,
        client_address: invoice.client_address,
        client_gstin: invoice.client_gstin,

        company_name: invoice.company_name,
        company_logo_url: invoice.company_logo_url,
        company_address: invoice.company_address,
        company_phone: invoice.company_phone,
        company_email: invoice.company_email,
        company_website: invoice.company_website,
        gstin: invoice.gstin,
        pan: invoice.pan,
        signature_url: invoice.signature_url,
        stamp_url: invoice.stamp_url,

        bank_name: invoice.bank_name,
        bank_account_no: invoice.bank_account_no,
        bank_ifsc: invoice.bank_ifsc,
        bank_beneficiary_name: invoice.bank_beneficiary_name,
        upi_id: invoice.upi_id,
        upi_qr_url: invoice.upi_qr_url,

        notes: invoice.notes,
        terms: invoice.terms,
        custom_message: invoice.custom_message,
        public_token: randomBytes(16).toString('hex'),
      };

      const { data: newTi, error: tiErr } = await supabase
        .from('invoices')
        .insert(taxInvoicePayload)
        .select()
        .single();

      if (!tiErr && newTi) {
        taxInvoice = newTi;
        // Copy items
        if (Array.isArray(invoice.items) && invoice.items.length > 0) {
          const tiItems = invoice.items.map((it: any) => ({
            invoice_id: newTi.id,
            position: it.position,
            title: it.title,
            description: it.description,
            quantity: it.quantity,
            unit_price: it.unit_price,
            tax_rate: it.tax_rate,
            total: it.total,
          }));
          await supabase.from('invoice_items').insert(tiItems);
        }

        // Increment next_tax_invoice_number
        await supabase
          .from('quotation_settings')
          .update({
            next_tax_invoice_number: nextNum + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('account_id', invoice.account_id);
      }
    }

    return NextResponse.json({
      success: true,
      proformaInvoice: updatedOriginal,
      taxInvoice: taxInvoice || updatedOriginal,
    });
  } catch (err: any) {
    console.error('[record-payment] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
