// GET /api/billing/invoices/:id  invoice + items + ledger lines (for the form)
// PUT /api/billing/invoices/:id  update from the form. Cancelled invoices
//     are read-only; the total can't drop below what's already paid;
//     editing one the client already has records a revision.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, UUID_RE } from "@/lib/billing/api";
import { persistInvoice } from "@/lib/billing/invoice-persist";
import { recordRevision, shouldBumpRevision } from "@/lib/billing/revisions";

type Params = { params: Promise<{ id: string }> };

async function load(ctx: Awaited<ReturnType<typeof requireRole>>, id: string) {
  return ctx.supabase
    .from("invoices")
    .select("*, items:invoice_items(*), ledger_lines:invoice_ledger_lines(*)")
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .is("deleted_at", null)
    .maybeSingle();
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("viewer");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data, error } = await load(ctx, id);
    if (error) return dbErrorResponse(error, "load the invoice");
    if (!data) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const byPos = (a: { position?: number }, b: { position?: number }) => (a.position ?? 0) - (b.position ?? 0);
    return NextResponse.json({
      invoice: { ...data, items: [...(data.items ?? [])].sort(byPos), ledger_lines: [...(data.ledger_lines ?? [])].sort(byPos) },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data: before, error: loadErr } = await load(ctx, id);
    if (loadErr) return dbErrorResponse(loadErr, "load the invoice");
    if (!before) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (before.status === "cancelled") {
      return NextResponse.json({ error: `${before.invoice_number} is cancelled and can't be edited` }, { status: 409 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // The type of an existing invoice never changes.
    const result = await persistInvoice(ctx, id, { ...body, invoice_type: before.invoice_type });
    if (result instanceof NextResponse) return result;

    let revision: number | null = null;
    if (shouldBumpRevision(before.status, before.sent_at)) {
      revision = await recordRevision(ctx.supabase, {
        table: "invoices",
        documentType: before.invoice_type === "tax_invoice" ? "tax_invoice" : "proforma",
        before,
        userId: ctx.userId,
        reason: result.input.revision_reason,
      });
    }
    return NextResponse.json({
      invoice: { id: result.id, invoice_number: result.invoice_number, invoice_type: result.invoice_type, status: result.status },
      revision,
      amounts_changed: Math.abs(Number(before.total_amount ?? 0) - result.total_amount) > 0.005,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/billing/invoices/:id — only drafts (issued invoices are
// cancelled / moved back instead, so numbering stays gap-free).
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data: inv, error: loadErr } = await ctx.supabase
      .from("invoices")
      .select("id, status, invoice_number")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .is("deleted_at", null)
      .maybeSingle();
    if (loadErr) return dbErrorResponse(loadErr, "delete the invoice");
    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (inv.status !== "draft") {
      return NextResponse.json({ error: `${inv.invoice_number} has been issued — move it back instead of deleting it` }, { status: 409 });
    }
    const { error } = await ctx.supabase.from("invoices").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("account_id", ctx.accountId);
    if (error) return dbErrorResponse(error, "delete the invoice");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
