// ============================================================
// POST /api/invoices/:id/revert   { to: "quotation" | "proforma", reason? }
//
// Move a proforma or tax invoice back to an earlier stage. All the
// work happens in revert_billing_document() (migration 074) inside one
// transaction: later-stage documents are cancelled (never deleted),
// the proforma's payment is reset or the quotation is reopened, and
// if the earlier stage never existed it is created from this document.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { to?: unknown; reason?: unknown };
    if (body.to !== "quotation" && body.to !== "proforma") {
      return NextResponse.json({ error: 'to must be "quotation" or "proforma"' }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

    const { data, error } = await ctx.supabase.rpc("revert_billing_document", {
      p_invoice_id: id,
      p_to: body.to,
      p_reason: reason || null,
    });

    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") {
        return NextResponse.json(
          { error: "Moving back a stage isn't set up yet — run migration 074_billing_revert.sql in Supabase." },
          { status: 503 },
        );
      }
      if (error.code === "42501") return NextResponse.json({ error: error.message }, { status: 403 });
      if (error.code === "P0002") return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 409 });
      console.error("[invoices/revert] rpc error:", error);
      return NextResponse.json({ error: "Could not move the document back" }, { status: 500 });
    }

    return NextResponse.json({ result: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
