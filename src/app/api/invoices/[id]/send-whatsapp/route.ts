import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getQuotationSettings } from '@/lib/quotations/settings';

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

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    const host = request.headers.get('host') || 'crm.deccanfilings.com';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const invoiceUrl = `${protocol}://${host}/invoice/${invoice.public_token}`;

    const isPaid = invoice.status === 'paid';
    const isTaxInvoice = invoice.invoice_type === 'tax_invoice';

    const message = isPaid || isTaxInvoice
      ? `*TAX INVOICE & PAYMENT RECEIPT*

Hello ${invoice.client_name},

Thank you for your payment! Here is your official Tax Invoice and Payment Receipt (${invoice.invoice_number}) for ${invoice.title}.

Total Paid: INR ${Number(invoice.paid_amount || invoice.total_amount).toLocaleString('en-IN')}
Balance Due: INR 0.00

View & Download Tax Invoice:
${invoiceUrl}

Thank you for choosing ${invoice.company_name || 'Deccan Filings'}!`
      : `*PROFORMA INVOICE*

Hello ${invoice.client_name},

Here is your Proforma Invoice (${invoice.invoice_number}) for ${invoice.title}.

Amount Payable: INR ${Number(invoice.total_amount).toLocaleString('en-IN')}

You can view bank details and pay instantly via UPI QR Code here:
${invoiceUrl}

Regards,
${invoice.company_name || 'Deccan Filings'}`;

    // Mark sent_at
    await supabase
      .from('invoices')
      .update({
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json({
      success: true,
      invoiceUrl,
      whatsappMessage: message,
      phone: invoice.client_phone,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
