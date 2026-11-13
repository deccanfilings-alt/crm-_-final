// GET  /api/billing/ledgers   list (+ the ledger group options)
// POST /api/billing/ledgers   create (owner / Team Leader)
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse } from "@/lib/billing/api";
import { LEDGER_GROUPS, validateLedger } from "@/lib/billing/masters";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const { data, error } = await ctx.supabase
      .from("billing_ledgers")
      .select("id, name, ledger_group, is_active, created_at")
      .eq("account_id", ctx.accountId)
      .order("name");
    if (error) return dbErrorResponse(error, "load ledgers");
    return NextResponse.json({ ledgers: data ?? [], groups: LEDGER_GROUPS });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateLedger(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from("billing_ledgers")
      .insert({ ...v.value, account_id: ctx.accountId })
      .select()
      .single();
    if (error?.code === "23505") return NextResponse.json({ error: `A ledger called "${v.value.name}" already exists` }, { status: 409 });
    if (error) return dbErrorResponse(error, "create the ledger");
    return NextResponse.json({ ledger: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
