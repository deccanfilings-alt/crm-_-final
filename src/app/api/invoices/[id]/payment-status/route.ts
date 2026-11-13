// ============================================================
// POST /api/invoices/:id/payment-status
//   { status: "unpaid" | "partially_paid" | "paid", paid_amount? }
//
// Quick manual correction of a proforma / tax invoice's payment
// status from the Status dropdown. Keeps paid / balance consistent.
// It does NOT create a tax invoice — Record Payment does that.
// Setting a proforma back to Unpaid while it has an active tax invoice
// is refused (409 has_tax_invoice): that goes through "Move back to
// Proforma", which cancels the tax invoice properly.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isPaymentStatus, paymentStatusUpdate } from "@/lib/billing/payment-status";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { status?: unknown; paid_amount?: unknown };
    if (!isPaymentStatus(body.status)) {
      return NextResponse.json({ error: "status must be unpaid, partially_paid or paid" }, { status: 400 });
    }

    const { data: inv, error: loadErr } = await ctx.supabase
      .from("invoices")
      .select("id, invoice_type, invoice_number, status, total_amount, paid_amount, paid_at, payment_method")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (loadErr) {
      console.error("[payment-status] load error:", loadErr);
      return NextResponse.json({ error: "Could not load the invoice" }, { status: 500 });
    }
    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (body.status === "unpaid" && inv.invoice_type === "proforma") {
      const { data: ti } = await ctx.supabase
        .from("invoices")
        .select("id, invoice_number")
        .eq("source_invoice_id", id)
        .eq("invoice_type", "tax_invoice")
        .neq("status", "cancelled")
        .limit(1)
        .maybeSingle();
      if (ti) {
        return NextResponse.json(
          {
            error: `Tax invoice ${ti.invoice_number} was issued for this payment — move it back to Proforma to mark this unpaid.`,
            code: "has_tax_invoice",
            tax_invoice_id: ti.id,
          },
          { status: 409 },
        );
      }
    }

    const amount = body.paid_amount == null || body.paid_amount === "" ? null : Number(body.paid_amount);
    const result = paymentStatusUpdate(inv, body.status, amount);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const { data: updated, error: updErr } = await ctx.supabase
      .from("invoices")
      .update(result.update)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("*, items:invoice_items(*)")
      .single();
    if (updErr) {
      console.error("[payment-status] update error:", updErr);
      return NextResponse.json({ error: "Could not update the payment status" }, { status: 500 });
    }
    return NextResponse.json({ invoice: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
