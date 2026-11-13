// PATCH / DELETE /api/billing/ledgers/:id  (owner / Team Leader)
// Quotation ledger lines keep their own label, so deleting is safe.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, UUID_RE } from "@/lib/billing/api";
import { validateLedger } from "@/lib/billing/masters";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateLedger(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from("billing_ledgers")
      .update({ ...v.value, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select()
      .maybeSingle();
    if (error?.code === "23505") return NextResponse.json({ error: `A ledger called "${v.value.name}" already exists` }, { status: 409 });
    if (error) return dbErrorResponse(error, "update the ledger");
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ledger: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { error } = await ctx.supabase.from("billing_ledgers").delete().eq("id", id).eq("account_id", ctx.accountId);
    if (error) return dbErrorResponse(error, "delete the ledger");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
