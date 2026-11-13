// GET /api/billing/clients/:id/tasks — the client's action items, for
// "Attach Tasks" on a quotation line (which work this line bills for).
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, UUID_RE } from "@/lib/billing/api";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("viewer");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from("action_items")
      .select("id, title, status, target_date, priority")
      .eq("account_id", ctx.accountId)
      .eq("contact_id", id)
      .neq("status", "cancelled")
      .order("target_date", { ascending: false })
      .limit(100);
    if (error) return dbErrorResponse(error, "load the client's tasks");
    return NextResponse.json({ tasks: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
