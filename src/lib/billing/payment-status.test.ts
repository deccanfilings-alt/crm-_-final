import { describe, expect, it } from "vitest";
import { isPaymentStatus, paymentStatusUpdate } from "./payment-status";

const now = new Date("2026-11-12T06:00:00Z");
const inv = { status: "unpaid", total_amount: 2950, paid_amount: 0, paid_at: null, payment_method: null };

describe("paymentStatusUpdate", () => {
  it("paid: full amount, zero balance, keeps an existing payment date", () => {
    expect(paymentStatusUpdate(inv, "paid", null, now)).toEqual({
      ok: true,
      update: {
        status: "paid",
        paid_amount: 2950,
        balance_amount: 0,
        paid_at: now.toISOString(),
        payment_method: "other",
        updated_at: now.toISOString(),
      },
    });
    const r = paymentStatusUpdate({ ...inv, paid_at: "2026-11-01T00:00:00Z", payment_method: "upi" }, "paid", null, now);
    expect(r.ok && r.update).toMatchObject({ paid_at: "2026-11-01T00:00:00Z", payment_method: "upi" });
  });
  it("partially paid: needs an amount below the total", () => {
    const r = paymentStatusUpdate(inv, "partially_paid", 1000, now);
    expect(r.ok && r.update).toMatchObject({ status: "partially_paid", paid_amount: 1000, balance_amount: 1950 });
    expect(paymentStatusUpdate(inv, "partially_paid", null, now)).toEqual({ ok: false, error: "Enter the amount received" });
    expect(paymentStatusUpdate(inv, "partially_paid", 0, now).ok).toBe(false);
    expect(paymentStatusUpdate(inv, "partially_paid", 2950, now).ok).toBe(false);
  });
  it("unpaid: clears the payment", () => {
    const r = paymentStatusUpdate({ ...inv, status: "paid", paid_amount: 2950 }, "unpaid", null, now);
    expect(r.ok && r.update).toMatchObject({
      status: "unpaid",
      paid_amount: 0,
      balance_amount: 2950,
      paid_at: null,
      payment_method: null,
      payment_reference: null,
    });
  });
  it("refuses cancelled documents and unknown statuses", () => {
    expect(paymentStatusUpdate({ ...inv, status: "cancelled" }, "paid", null, now).ok).toBe(false);
    expect(isPaymentStatus("paid")).toBe(true);
    expect(isPaymentStatus("cancelled")).toBe(false);
  });
});
