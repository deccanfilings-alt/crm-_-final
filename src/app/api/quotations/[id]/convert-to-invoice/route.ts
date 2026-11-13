// POST /api/quotations/:id/convert-to-invoice
//   { invoice_type: "proforma" | "tax_invoice", invoice_date?, due_days?,
//     payment_received?, payment_method?, payment_reference? }
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { convertQuotationToInvoice } from '@/lib/billing/convert';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const invoiceType = body.invoice_type === 'tax_invoice' ? 'tax_invoice' : 'proforma';

    const result = await convertQuotationToInvoice(ctx.supabase, ctx.userId, id, {
      invoiceType,
      invoiceDate: typeof body.invoice_date === 'string' ? body.invoice_date : null,
      dueDays: body.due_days == null || body.due_days === '' ? null : Number(body.due_days),
      paymentReceived: body.payment_received !== false && body.status !== 'unpaid',
      paymentMethod: typeof body.payment_method === 'string' ? body.payment_method : null,
      paymentReference: typeof body.payment_reference === 'string' ? body.payment_reference : null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, invoice: result.invoice });
  } catch (err) {
    return toErrorResponse(err);
  }
}
