// ============================================================
// Manually set an invoice's payment status (the Status dropdown on
// the billing hub). Pure: works out the fields to update so the
// status, paid amount and balance always agree.
// ============================================================

import { round2 } from "./revisions";

export type PaymentStatus = "unpaid" | "partially_paid" | "paid";
export const PAYMENT_STATUSES: readonly PaymentStatus[] = ["unpaid", "partially_paid", "paid"];

export function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === "string" && (PAYMENT_STATUSES as readonly string[]).includes(v);
}

interface InvoiceLike {
  status: string;
  total_amount: number | string;
  paid_amount?: number | string | null;
  paid_at?: string | null;
  payment_method?: string | null;
}

export type PaymentUpdate =
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; error: string };

export function paymentStatusUpdate(
  inv: InvoiceLike,
  status: PaymentStatus,
  amount?: number | null,
  now: Date = new Date(),
): PaymentUpdate {
  if (inv.status === "cancelled") return { ok: false, error: "This document is cancelled" };
  const total = round2(Number(inv.total_amount) || 0);
  const nowIso = now.toISOString();

  if (status === "unpaid") {
    return {
      ok: true,
      update: {
        status: "unpaid",
        paid_amount: 0,
        balance_amount: total,
        payment_method: null,
        payment_reference: null,
        paid_at: null,
        updated_at: nowIso,
      },
    };
  }

  if (status === "paid") {
    return {
      ok: true,
      update: {
        status: "paid",
        paid_amount: total,
        balance_amount: 0,
        paid_at: inv.paid_at ?? nowIso,
        payment_method: inv.payment_method ?? "other",
        updated_at: nowIso,
      },
    };
  }

  // partially_paid
  const paid = round2(Number(amount));
  if (amount == null || !Number.isFinite(paid) || paid <= 0) return { ok: false, error: "Enter the amount received" };
  if (paid >= total) return { ok: false, error: "That covers the full amount — choose Paid instead" };
  return {
    ok: true,
    update: {
      status: "partially_paid",
      paid_amount: paid,
      balance_amount: round2(total - paid),
      paid_at: inv.paid_at ?? nowIso,
      payment_method: inv.payment_method ?? "other",
      updated_at: nowIso,
    },
  };
}
