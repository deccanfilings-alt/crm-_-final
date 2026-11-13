// GET /api/billing/tax-rates  -> { gst: number[], vat: number[] }
// PUT /api/billing/tax-rates  { gst: [], vat: [] }  replace both lists (owner / Team Leader)
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse } from "@/lib/billing/api";
import { validateTaxRates } from "@/lib/billing/masters";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const { data, error } = await ctx.supabase
      .from("billing_tax_rates")
      .select("kind, rate")
      .eq("account_id", ctx.accountId)
      .order("rate");
    if (error) return dbErrorResponse(error, "load tax rates");
    const rows = data ?? [];
    return NextResponse.json({
      gst: rows.filter((r) => r.kind === "GST").map((r) => Number(r.rate)),
      vat: rows.filter((r) => r.kind === "VAT").map((r) => Number(r.rate)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const v = validateTaxRates(body);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

    const wanted = [
      ...v.value.GST.map((rate) => ({ kind: "GST", rate })),
      ...v.value.VAT.map((rate) => ({ kind: "VAT", rate })),
    ];
    // Add the new ones first, then remove what's no longer listed.
    const { error: upErr } = await ctx.supabase
      .from("billing_tax_rates")
      .upsert(wanted.map((w) => ({ ...w, account_id: ctx.accountId })), { onConflict: "account_id,kind,rate", ignoreDuplicates: true });
    if (upErr) return dbErrorResponse(upErr, "save tax rates");

    const { data: existing, error: loadErr } = await ctx.supabase
      .from("billing_tax_rates")
      .select("id, kind, rate")
      .eq("account_id", ctx.accountId);
    if (loadErr) return dbErrorResponse(loadErr, "save tax rates");
    const keep = new Set(wanted.map((w) => `${w.kind}:${w.rate}`));
    const remove = (existing ?? []).filter((r) => !keep.has(`${r.kind}:${Number(r.rate)}`)).map((r) => r.id);
    if (remove.length) {
      const { error: delErr } = await ctx.supabase.from("billing_tax_rates").delete().in("id", remove);
      if (delErr) return dbErrorResponse(delErr, "save tax rates");
    }
    return NextResponse.json({ gst: v.value.GST, vat: v.value.VAT });
  } catch (err) {
    return toErrorResponse(err);
  }
}
