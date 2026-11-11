import { describe, expect, it, vi } from "vitest";
import { invoiceStatusFor, isCommercialChange, recordRevision, round2, shouldBumpRevision } from "./revisions";

const before = {
  items: [{ title: "GST filing", description: "Monthly", quantity: 1, unit_price: 5000 }],
  discount_type: "none",
  discount_value: 0,
  tax_type: "gst",
  tax_rate: 18,
};

describe("isCommercialChange", () => {
  it("ignores text-only edits and identical items", () => {
    expect(isCommercialChange(before, {})).toBe(false);
    expect(isCommercialChange(before, { items: [{ title: " GST filing ", description: "Monthly", quantity: 1, unit_price: 5000 }] })).toBe(false);
    expect(isCommercialChange(before, { tax_rate: 18, discount_type: "none" })).toBe(false);
  });
  it("detects price, quantity, item, discount and tax changes", () => {
    expect(isCommercialChange(before, { items: [{ title: "GST filing", description: "Monthly", quantity: 2, unit_price: 5000 }] })).toBe(true);
    expect(isCommercialChange(before, { items: [{ title: "GST filing", description: "Monthly", quantity: 1, unit_price: 4500 }] })).toBe(true);
    expect(isCommercialChange(before, { items: [] })).toBe(true);
    expect(isCommercialChange(before, { discount_type: "fixed", discount_value: 500 })).toBe(true);
    expect(isCommercialChange(before, { tax_rate: 12 })).toBe(true);
  });
});

describe("invoiceStatusFor", () => {
  it("follows the money after a total change", () => {
    expect(invoiceStatusFor("paid", 6000, 5900)).toBe("partially_paid"); // total went up
    expect(invoiceStatusFor("partially_paid", 5000, 5000)).toBe("paid"); // total came down to paid
    expect(invoiceStatusFor("unpaid", 5000, 0)).toBe("unpaid");
    expect(invoiceStatusFor("paid", 1000.004, 1000)).toBe("paid"); // rounding tolerance
  });
  it("keeps draft and cancelled as they are", () => {
    expect(invoiceStatusFor("draft", 5000, 0)).toBe("draft");
    expect(invoiceStatusFor("cancelled", 5000, 100)).toBe("cancelled");
  });
});

describe("shouldBumpRevision / round2", () => {
  it("bumps only once a document has gone out", () => {
    expect(shouldBumpRevision("draft", null)).toBe(false);
    expect(shouldBumpRevision("draft", "2026-11-01T00:00:00Z")).toBe(true);
    expect(shouldBumpRevision("sent", null)).toBe(true);
    expect(shouldBumpRevision("unpaid", null)).toBe(true);
  });
  it("rounds to paise", () => {
    expect(round2(1180.005)).toBe(1180.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("recordRevision", () => {
  function fakeDb(opts: { insertError?: string; updateError?: string } = {}) {
    const calls: Array<{ table: string; op: string; payload: unknown }> = [];
    const db = {
      from: (table: string) => ({
        insert: async (payload: unknown) => {
          calls.push({ table, op: "insert", payload });
          return { error: opts.insertError ? { message: opts.insertError } : null };
        },
        update: (payload: unknown) => ({
          eq: async () => {
            calls.push({ table, op: "update", payload });
            return { error: opts.updateError ? { message: opts.updateError } : null };
          },
        }),
      }),
    };
    return { db, calls };
  }

  it("snapshots the old version and bumps the counter", async () => {
    const { db, calls } = fakeDb();
    const n = await recordRevision(db as never, {
      table: "invoices",
      documentType: "tax_invoice",
      before: { id: "inv-1", account_id: "acc-1", revision: 1, total_amount: 5900 },
      userId: "u1",
      reason: "  Client asked to drop item 2 ",
    });
    expect(n).toBe(2);
    expect(calls[0]).toMatchObject({ table: "document_revisions", op: "insert" });
    expect(calls[0].payload).toMatchObject({ document_type: "tax_invoice", document_id: "inv-1", revision: 1, reason: "Client asked to drop item 2" });
    expect(calls[1]).toMatchObject({ table: "invoices", op: "update", payload: expect.objectContaining({ revision: 2 }) });
  });

  it("never throws if the revisions migration isn't applied", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { db, calls } = fakeDb({ insertError: 'relation "document_revisions" does not exist' });
    const n = await recordRevision(db as never, {
      table: "quotations",
      documentType: "quotation",
      before: { id: "q-1", account_id: "acc-1" },
      userId: "u1",
    });
    expect(n).toBeNull();
    expect(calls).toHaveLength(1); // no revision bump attempted
    warn.mockRestore();
  });
});
