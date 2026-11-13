// GET  /api/billing/clients?q=   client search for the quotation form
//      (contacts with their billing fields)
// POST /api/billing/clients      quick "+ New client" from the form.
//      Re-uses an existing contact with the same phone number.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { CLIENT_FIELDS, dbErrorResponse } from "@/lib/billing/api";
import { canonicalState } from "@/lib/billing/states";
import { canonicalPhone, findExistingContact } from "@/lib/contacts/dedupe";

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("viewer");
    const sp = new URL(request.url).searchParams;
    const byId = sp.get("id");
    if (byId) {
      if (!/^[0-9a-f-]{36}$/i.test(byId)) return NextResponse.json({ clients: [] });
      const { data, error } = await ctx.supabase.from("contacts").select(CLIENT_FIELDS).eq("account_id", ctx.accountId).eq("id", byId);
      if (error) return dbErrorResponse(error, "load the client");
      return NextResponse.json({ clients: data ?? [] });
    }
    const q = (sp.get("q") ?? "").trim().replace(/[%,()*]/g, "");
    let query = ctx.supabase
      .from("contacts")
      .select(CLIENT_FIELDS)
      .eq("account_id", ctx.accountId)
      .order("name", { ascending: true })
      .limit(25);
    if (q) {
      const digits = q.replace(/\D/g, "");
      const parts = [`name.ilike.%${q}%`, `company.ilike.%${q}%`, `gstin.ilike.%${q}%`];
      if (digits.length >= 3) parts.push(`phone.ilike.%${digits}%`);
      query = query.or(parts.join(","));
    }
    const { data, error } = await query;
    if (error) return dbErrorResponse(error, "search clients");
    return NextResponse.json({ clients: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
    const name = str(body.name, 200);
    const phoneRaw = str(body.phone, 30);
    if (!name) return NextResponse.json({ error: "Client name is required" }, { status: 400 });
    if (!phoneRaw || phoneRaw.replace(/\D/g, "").length < 10) {
      return NextResponse.json({ error: "A 10-digit mobile number is required" }, { status: 400 });
    }
    const phone = canonicalPhone(phoneRaw);

    const billing = {
      email: str(body.email, 200),
      company: str(body.company, 200),
      address: str(body.address, 500),
      city: str(body.city, 100),
      state: canonicalState(str(body.state, 100)) ?? str(body.state, 100),
      pincode: str(body.pincode, 10),
      gstin: str(body.gstin, 15)?.toUpperCase() ?? null,
      pan: str(body.pan, 10)?.toUpperCase() ?? null,
    };

    const existing = await findExistingContact(ctx.supabase, ctx.accountId, phone);
    if (existing) {
      const { data } = await ctx.supabase.from("contacts").select(CLIENT_FIELDS).eq("id", existing.id).maybeSingle();
      return NextResponse.json({ client: data ?? existing, existing: true });
    }

    const { data, error } = await ctx.supabase
      .from("contacts")
      .insert({ account_id: ctx.accountId, user_id: ctx.userId, name, phone, ...billing })
      .select(CLIENT_FIELDS)
      .single();
    if (error) return dbErrorResponse(error, "create the client");
    return NextResponse.json({ client: data, existing: false }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
