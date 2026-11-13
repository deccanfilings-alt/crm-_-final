// Small helpers shared by the /api/billing/* routes.
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

type PgError = { code?: string; message?: string } | null | undefined;

/** Table / function missing: migration 076 not applied yet. */
export function isSchemaMissing(err: PgError): boolean {
  return !!err?.code && ["42P01", "42883", "42703", "PGRST202", "PGRST204", "PGRST205"].includes(err.code);
}

export function dbErrorResponse(err: PgError, label: string): NextResponse {
  if (isSchemaMissing(err)) {
    return NextResponse.json(
      { error: "Billing settings aren't set up yet — run migration 076_billing_quotation_upgrade.sql in Supabase." },
      { status: 503 },
    );
  }
  if (err?.code === "23505") return NextResponse.json({ error: "That already exists" }, { status: 409 });
  if (err?.code === "42501") return NextResponse.json({ error: "You don't have permission to do that" }, { status: 403 });
  console.error(`[billing] ${label}:`, err);
  return NextResponse.json({ error: `Could not ${label}` }, { status: 500 });
}

/** The account's default (only) firm id. */
export async function defaultFirmId(supabase: SupabaseClient, accountId: string): Promise<{ id: string | null; error: PgError }> {
  const { data, error } = await supabase
    .from("billing_firms")
    .select("id")
    .eq("account_id", accountId)
    .eq("is_default", true)
    .maybeSingle();
  return { id: data?.id ?? null, error };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contact columns the billing forms use (Billed To). */
export const CLIENT_FIELDS =
  "id, name, phone, email, company, address, city, state, pincode, gstin, pan, cin, proprietor_name, tags";
