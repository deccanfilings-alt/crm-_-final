// GET  /api/billing/particulars?q=   list (active first, by name)
// POST /api/billing/particulars      create (Team Member+, also used inline from the quotation form)
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse } from "@/lib/billing/api";
import { validateParticular } from "@/lib/billing/masters";

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("viewer");
    const q = new URL(request.url).searchParams.get("q")?.trim();
    let query = ctx.supabase
      .from("billing_particulars")
      .select("id, name, service_name, gst_rate, vat_rate, sac_code, description, default_amount, is_active, created_at")
      .eq("account_id", ctx.accountId)
      .order("name")
      .limit(500);
    // Strip characters that would break PostgREST's or() filter syntax.
    const term = q?.replace(/[%,()*]/g, "");
    if (term) query = query.or(`name.ilike.%${term}%,service_name.ilike.%${term}%,sac_code.ilike.%${term}%`);
    const { data, error } = await query;
    if (error) return dbErrorResponse(error, "load particulars");
    return NextResponse.json({ particulars: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateParticular(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from("billing_particulars")
      .insert({ ...v.value, account_id: ctx.accountId, created_by: ctx.userId })
      .select()
      .single();
    if (error) return dbErrorResponse(error, "create the particular");
    return NextResponse.json({ particular: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
