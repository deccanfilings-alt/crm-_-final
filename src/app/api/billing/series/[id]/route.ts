// PUT    /api/billing/series/:id  { name?, is_default?, periods? }  (owner / Team Leader)
//        periods replace the numbering rows: existing rows (by id) are
//        updated, new ones added, missing ones removed.
// DELETE /api/billing/series/:id  (not the default series)
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, UUID_RE } from "@/lib/billing/api";
import { validateSeriesPeriods } from "@/lib/billing/masters";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; is_default?: unknown; periods?: unknown };

    const { data: series, error: loadErr } = await ctx.supabase
      .from("billing_series")
      .select("id, firm_id, doc_type, is_default")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (loadErr) return dbErrorResponse(loadErr, "update the series");
    if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });

    // Validate everything before writing anything.
    let name: string | undefined;
    if (body.name !== undefined) {
      name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
      if (!name) return NextResponse.json({ error: "Series name is required" }, { status: 400 });
    }
    const periods = body.periods !== undefined ? validateSeriesPeriods(body.periods) : null;
    if (periods && !periods.ok) return NextResponse.json({ error: periods.error }, { status: 400 });

    if (name) {
      const { error } = await ctx.supabase.from("billing_series").update({ name, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) return dbErrorResponse(error, "rename the series");
    }

    if (body.is_default === true && !series.is_default) {
      // One default per firm + type: clear the old one first.
      const { error: clearErr } = await ctx.supabase
        .from("billing_series")
        .update({ is_default: false })
        .eq("firm_id", series.firm_id)
        .eq("doc_type", series.doc_type)
        .eq("is_default", true);
      if (clearErr) return dbErrorResponse(clearErr, "set the default series");
      const { error } = await ctx.supabase.from("billing_series").update({ is_default: true }).eq("id", id);
      if (error) return dbErrorResponse(error, "set the default series");
    }

    if (periods?.ok) {
      const { data: existing, error: exErr } = await ctx.supabase
        .from("billing_series_periods")
        .select("id")
        .eq("series_id", id);
      if (exErr) return dbErrorResponse(exErr, "save the numbering");
      const existingIds = new Set((existing ?? []).map((p) => p.id));
      const keepIds = new Set(periods.value.map((p) => p.id).filter((x): x is string => !!x && existingIds.has(x)));

      for (const [position, p] of periods.value.entries()) {
        const row = {
          position,
          prefix: p.prefix,
          suffix: p.suffix,
          applicable_from: p.applicable_from,
          applicable_to: p.applicable_to,
          starting_no: p.starting_no,
          next_no: p.next_no,
        };
        const res = p.id && keepIds.has(p.id)
          ? await ctx.supabase.from("billing_series_periods").update(row).eq("id", p.id)
          : await ctx.supabase.from("billing_series_periods").insert({ ...row, series_id: id });
        if (res.error) return dbErrorResponse(res.error, "save the numbering");
      }
      const remove = [...existingIds].filter((x) => !keepIds.has(x));
      if (remove.length) {
        const { error } = await ctx.supabase.from("billing_series_periods").delete().in("id", remove);
        if (error) return dbErrorResponse(error, "save the numbering");
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data: series, error: loadErr } = await ctx.supabase
      .from("billing_series")
      .select("id, is_default")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (loadErr) return dbErrorResponse(loadErr, "delete the series");
    if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });
    if (series.is_default) {
      return NextResponse.json({ error: "Make another series the default before deleting this one" }, { status: 409 });
    }
    const { error } = await ctx.supabase.from("billing_series").delete().eq("id", id);
    if (error) return dbErrorResponse(error, "delete the series");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
