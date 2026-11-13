// GET /api/billing/client-groups — contact tags, used as "Client Group Name"
// in the billing list filters.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse } from "@/lib/billing/api";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const { data, error } = await ctx.supabase
      .from("tags")
      .select("id, name, color")
      .eq("account_id", ctx.accountId)
      .order("name");
    if (error) return dbErrorResponse(error, "load client groups");
    return NextResponse.json({ groups: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}
