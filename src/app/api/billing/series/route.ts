// GET  /api/billing/series?doc_type=quotation
//      -> series of the default firm, each with its numbering rows and
//         the next number it would give today.
// POST /api/billing/series  { name, doc_type }  (owner / Team Leader)
//      creates a series with one undated row (prefix from the name).
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, defaultFirmId } from "@/lib/billing/api";

const DOC_TYPES = ["quotation", "invoice", "receipt"] as const;
type DocType = (typeof DOC_TYPES)[number];
const isDocType = (v: unknown): v is DocType => typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("viewer");
    const docType = new URL(request.url).searchParams.get("doc_type") ?? "quotation";
    if (!isDocType(docType)) return NextResponse.json({ error: "Unknown document type" }, { status: 400 });

    const firm = await defaultFirmId(ctx.supabase, ctx.accountId);
    if (firm.error) return dbErrorResponse(firm.error, "load series");
    if (!firm.id) return NextResponse.json({ series: [] });

    const { data, error } = await ctx.supabase
      .from("billing_series")
      .select("id, name, doc_type, is_default, created_at, periods:billing_series_periods(id, position, prefix, suffix, applicable_from, applicable_to, starting_no, next_no)")
      .eq("firm_id", firm.id)
      .eq("doc_type", docType)
      .order("created_at");
    if (error) return dbErrorResponse(error, "load series");

    const today = new Date().toISOString().slice(0, 10);
    const series = await Promise.all(
      (data ?? []).map(async (s) => {
        const { data: preview } = await ctx.supabase.rpc("billing_series_preview", { p_series_id: s.id, p_doc_date: today });
        return {
          ...s,
          periods: [...(s.periods ?? [])].sort((a, b) => a.position - b.position),
          next_number: (preview as { number?: string | null } | null)?.number ?? null,
        };
      }),
    );
    return NextResponse.json({ series, firm_id: firm.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; doc_type?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) return NextResponse.json({ error: "Series name is required" }, { status: 400 });
    const docType = body.doc_type ?? "quotation";
    if (!isDocType(docType)) return NextResponse.json({ error: "Unknown document type" }, { status: 400 });

    const firm = await defaultFirmId(ctx.supabase, ctx.accountId);
    if (firm.error) return dbErrorResponse(firm.error, "create the series");
    if (!firm.id) return NextResponse.json({ error: "Save Settings → Billing → Company & Bank first" }, { status: 409 });

    const { count } = await ctx.supabase
      .from("billing_series")
      .select("id", { count: "exact", head: true })
      .eq("firm_id", firm.id)
      .eq("doc_type", docType);

    const { data: series, error } = await ctx.supabase
      .from("billing_series")
      .insert({ account_id: ctx.accountId, firm_id: firm.id, doc_type: docType, name, is_default: (count ?? 0) === 0 })
      .select()
      .single();
    if (error) return dbErrorResponse(error, "create the series");

    const prefix = `${name.replace(/[^A-Za-z0-9]+/g, "").slice(0, 6).toUpperCase() || "DOC"}-`;
    const { error: pErr } = await ctx.supabase
      .from("billing_series_periods")
      .insert({ series_id: series.id, position: 0, prefix, suffix: "", starting_no: 1, next_no: 1 });
    if (pErr) return dbErrorResponse(pErr, "create the series");

    return NextResponse.json({ series }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
