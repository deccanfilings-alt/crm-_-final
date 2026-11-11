// ============================================================
// Editing sent quotations / invoices — shared rules (pure helpers +
// a best-effort revision recorder).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type DocumentType = "quotation" | "proforma" | "tax_invoice";

export interface LineItemInput {
  title: string;
  description?: string | null;
  quantity: number;
  unit_price: number;
}

/** Normalise line items for comparison (ignores ids / positions / derived totals). */
function itemsKey(items: Array<Partial<LineItemInput>> | null | undefined): string {
  return JSON.stringify(
    (items ?? []).map((it) => [
      String(it.title ?? "").trim(),
      String(it.description ?? "").trim(),
      Number(it.quantity ?? 0),
      Number(it.unit_price ?? 0),
    ]),
  );
}

/**
 * Did the edit change what the client is being charged for?
 * (items, quantities, prices, discount or tax). Text-only edits like
 * notes or address don't count.
 */
export function isCommercialChange(
  before: {
    items?: Array<Partial<LineItemInput>> | null;
    discount_type?: string | null;
    discount_value?: number | null;
    tax_type?: string | null;
    tax_rate?: number | null;
  },
  after: {
    items?: Array<Partial<LineItemInput>> | null;
    discount_type?: string | null;
    discount_value?: number | null;
    tax_type?: string | null;
    tax_rate?: number | null;
  },
): boolean {
  if (after.items !== undefined && itemsKey(after.items) !== itemsKey(before.items)) return true;
  const changed = (k: "discount_type" | "discount_value" | "tax_type" | "tax_rate") =>
    after[k] !== undefined && String(after[k] ?? "") !== String(before[k] ?? "");
  return changed("discount_type") || changed("discount_value") || changed("tax_type") || changed("tax_rate");
}

/**
 * Payment status after the invoice total changed. Draft and cancelled
 * invoices keep their status; otherwise it follows the money.
 */
export function invoiceStatusFor(
  current: string,
  totalAmount: number,
  paidAmount: number,
): string {
  if (current === "draft" || current === "cancelled") return current;
  if (paidAmount <= 0) return "unpaid";
  if (paidAmount + 0.005 >= totalAmount) return "paid";
  return "partially_paid";
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A sent document gets a new revision number when edited; drafts don't. */
export function shouldBumpRevision(status: string, sentAt: string | null | undefined): boolean {
  return status !== "draft" || Boolean(sentAt);
}

/**
 * Record the pre-edit snapshot and bump the revision counter.
 * Best-effort: if migration 071 hasn't been applied the edit itself has
 * already succeeded, so failures here are only logged.
 */
export async function recordRevision(
  supabase: SupabaseClient,
  args: {
    table: "quotations" | "invoices";
    documentType: DocumentType;
    before: Record<string, unknown> & { id: string; account_id: string; revision?: number | null };
    userId: string;
    reason?: string | null;
  },
): Promise<number | null> {
  const current = Number(args.before.revision ?? 0);
  try {
    const { error: histErr } = await supabase.from("document_revisions").insert({
      account_id: args.before.account_id,
      document_type: args.documentType,
      document_id: args.before.id,
      revision: current,
      snapshot: args.before,
      edited_by: args.userId,
      reason: args.reason?.trim() || null,
    });
    if (histErr) {
      console.warn("[billing/revisions] history insert skipped:", histErr.message);
      return null;
    }
    const next = current + 1;
    const { error: bumpErr } = await supabase
      .from(args.table)
      .update({ revision: next, revised_at: new Date().toISOString() })
      .eq("id", args.before.id);
    if (bumpErr) {
      console.warn("[billing/revisions] revision bump skipped:", bumpErr.message);
      return null;
    }
    return next;
  } catch (err) {
    console.warn("[billing/revisions] failed:", err);
    return null;
  }
}
