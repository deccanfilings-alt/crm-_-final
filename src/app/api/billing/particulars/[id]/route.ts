// PATCH / DELETE /api/billing/particulars/:id
// Deleting is safe: quotation lines keep their own copy of the text.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, UUID_RE } from "@/lib/billing/api";
import { validateParticular } from "@/lib/billing/masters";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateParticular(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from("billing_particulars")
      .update({
        ...v.value,
        ...(typeof body.is_active === "boolean" ? { is_active: body.is_active } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select()
      .maybeSingle();
    if (error) return dbErrorResponse(error, "update the particular");
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ particular: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { error } = await ctx.supabase.from("billing_particulars").delete().eq("id", id).eq("account_id", ctx.accountId);
    if (error) return dbErrorResponse(error, "delete the particular");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
