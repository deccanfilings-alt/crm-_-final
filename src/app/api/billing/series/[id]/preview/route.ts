// GET /api/billing/series/:id/preview?date=YYYY-MM-DD
// The number this series would give for that date (nothing is used up).
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, UUID_RE } from "@/lib/billing/api";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("viewer");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const date = new URL(request.url).searchParams.get("date");
    const { data, error } = await ctx.supabase.rpc("billing_series_preview", {
      p_series_id: id,
      p_doc_date: date && DATE.test(date) ? date : new Date().toISOString().slice(0, 10),
    });
    if (error) return dbErrorResponse(error, "preview the number");
    return NextResponse.json({ preview: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
