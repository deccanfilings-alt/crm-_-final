// POST /api/billing/quotations/convert
//   { ids: string[], invoice_type, invoice_date, due_days, payment_received? }
// Bulk "Convert To Invoice": one invoice per quotation. Each one is
// independent — a failure on one doesn't stop the rest.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { UUID_RE } from "@/lib/billing/api";
import { convertQuotationToInvoice } from "@/lib/billing/convert";

const MAX = 100;

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)))] : [];
    if (!ids.length) return NextResponse.json({ error: "Select at least one quotation" }, { status: 400 });
    if (ids.length > MAX) return NextResponse.json({ error: `Convert at most ${MAX} at a time` }, { status: 400 });
    const date = typeof body.invoice_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.invoice_date) ? body.invoice_date : null;
    const dueDays = body.due_days == null || body.due_days === "" ? null : Number(body.due_days);
    if (dueDays !== null && (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 3650)) {
      return NextResponse.json({ error: "Due days must be a whole number" }, { status: 400 });
    }
    const invoiceType = body.invoice_type === "tax_invoice" ? "tax_invoice" : "proforma";

    // Sequential: numbers come out in order and nothing races.
    const results: Array<{ id: string; ok: boolean; invoice_number?: string; error?: string }> = [];
    for (const id of ids) {
      const r = await convertQuotationToInvoice(ctx.supabase, ctx.userId, id, {
        invoiceType,
        invoiceDate: date,
        dueDays,
        paymentReceived: body.payment_received !== false,
      });
      results.push(r.ok ? { id, ok: true, invoice_number: r.invoice.invoice_number } : { id, ok: false, error: r.error });
    }
    return NextResponse.json({
      results,
      converted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
