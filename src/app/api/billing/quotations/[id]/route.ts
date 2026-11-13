// GET /api/billing/quotations/:id  quotation + items + ledger lines (for the form)
// PUT /api/billing/quotations/:id  update from the form. Invoiced and
//     cancelled quotations are read-only. Editing one the client already
//     has records a revision (Rev N) with a snapshot of the old version.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, UUID_RE } from "@/lib/billing/api";
import { persistQuotation } from "@/lib/billing/quotation-persist";
import { isCommercialChange, recordRevision, shouldBumpRevision } from "@/lib/billing/revisions";

type Params = { params: Promise<{ id: string }> };

async function load(ctx: Awaited<ReturnType<typeof requireRole>>, id: string) {
  return ctx.supabase
    .from("quotations")
    .select("*, items:quotation_items(*), ledger_lines:quotation_ledger_lines(*)")
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
    if (error) return dbErrorResponse(error, "load the quotation");
    if (!data) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    const sortByPos = (a: { position?: number }, b: { position?: number }) => (a.position ?? 0) - (b.position ?? 0);
    return NextResponse.json({
      quotation: {
        ...data,
        items: [...(data.items ?? [])].sort(sortByPos),
        ledger_lines: [...(data.ledger_lines ?? [])].sort(sortByPos),
      },
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
    if (loadErr) return dbErrorResponse(loadErr, "load the quotation");
    if (!before) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    if (before.status === "invoiced" || before.status === "cancelled") {
      return NextResponse.json(
        {
          error:
            before.status === "invoiced"
              ? "This quotation is already invoiced. Edit the invoice, or move it back to the quotation stage first."
              : "This quotation is cancelled. Change its status back to Draft or Final to edit it.",
        },
        { status: 409 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await persistQuotation(ctx, id, body);
    if (result instanceof NextResponse) return result;

    // Client accepted different terms: a price change clears that.
    const commercial =
      Math.abs(Number(before.total_amount ?? 0) - result.total_amount) > 0.005 ||
      isCommercialChange({ items: before.items ?? [] }, { items: result.input.items });
    let reopened = false;
    if (commercial && (before.accepted_at || before.rejected_at)) {
      await ctx.supabase.from("quotations").update({ accepted_at: null, rejected_at: null }).eq("id", id);
      reopened = true;
    }

    let revision: number | null = null;
    if (shouldBumpRevision(before.status, before.sent_at)) {
      revision = await recordRevision(ctx.supabase, {
        table: "quotations",
        documentType: "quotation",
        before,
        userId: ctx.userId,
        reason: result.input.revision_reason,
      });
    }

    return NextResponse.json({
      quotation: { id: result.id, quote_number: result.quote_number, status: result.status },
      revision,
      reopened,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// DELETE /api/billing/quotations/:id — "Delete Quotation". Soft delete:
// hidden from lists, kept in the database. Not allowed once invoiced.
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data: q, error: loadErr } = await ctx.supabase
      .from("quotations")
      .select("id, status, quote_number")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .is("deleted_at", null)
      .maybeSingle();
    if (loadErr) return dbErrorResponse(loadErr, "delete the quotation");
    if (!q) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    if (q.status === "invoiced") {
      return NextResponse.json({ error: `${q.quote_number} is invoiced and can't be deleted` }, { status: 409 });
    }
    const { error } = await ctx.supabase
      .from("quotations")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("account_id", ctx.accountId);
    if (error) return dbErrorResponse(error, "delete the quotation");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
