// GET /api/billing/quotations/form-data?date=YYYY-MM-DD&type=quotation|proforma|tax_invoice
// Everything the Create / Update Quotation form needs in one call:
// the firm (Issued By), its quotation series with the next number,
// GST rates and ledgers.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse } from "@/lib/billing/api";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("viewer");
    const sp = new URL(request.url).searchParams;
    const dateParam = sp.get("date");
    const typeParam = sp.get("type");
    const docType = typeParam === "proforma" || typeParam === "tax_invoice" ? typeParam : "quotation";
    const date = dateParam && DATE.test(dateParam) ? dateParam : new Date().toISOString().slice(0, 10);

    const { data: firm, error: firmErr } = await ctx.supabase
      .from("billing_firms")
      .select("id, name, tax_type, gstin, pan, cin, state, address_line1, address_line2, city, pincode, phone, email, website, logo_url, signature_url, stamp_url, terms_and_conditions, credit_period_days, default_gst_rate")
      .eq("account_id", ctx.accountId)
      .eq("is_default", true)
      .maybeSingle();
    if (firmErr) return dbErrorResponse(firmErr, "load the quotation form");
    if (!firm) {
      return NextResponse.json(
        { error: "Set up your company first: Settings → Billing → Company & Bank, then Save." },
        { status: 409 },
      );
    }

    const [series, rates, ledgers] = await Promise.all([
      ctx.supabase
        .from("billing_series")
        .select("id, name, is_default")
        .eq("firm_id", firm.id)
        .eq("doc_type", docType)
        .order("created_at"),
      ctx.supabase.from("billing_tax_rates").select("rate").eq("account_id", ctx.accountId).eq("kind", "GST").order("rate"),
      ctx.supabase.from("billing_ledgers").select("id, name, ledger_group").eq("account_id", ctx.accountId).eq("is_active", true).order("name"),
    ]);
    const err = series.error ?? rates.error ?? ledgers.error;
    if (err) return dbErrorResponse(err, "load the quotation form");

    const seriesWithNext = await Promise.all(
      (series.data ?? []).map(async (s) => {
        const { data } = await ctx.supabase.rpc("billing_series_preview", { p_series_id: s.id, p_doc_date: date });
        return { ...s, preview: data ?? null };
      }),
    );

    return NextResponse.json({
      firm,
      series: seriesWithNext,
      gst_rates: (rates.data ?? []).map((r) => Number(r.rate)),
      ledgers: ledgers.data ?? [],
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
