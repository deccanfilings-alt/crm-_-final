import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "agent",
  inserted: [] as Array<{ table: string; row: unknown }>,
  deleted: [] as string[],
  updated: [] as Array<Record<string, unknown>>,
  itemsError: null as null | { message: string },
  settingsUpdates: [] as unknown[],
  // next_document_number() (migration 075): null = function missing (legacy path)
  rpcNumbers: [] as string[] | null,
  rpcCalls: [] as unknown[],
  dupFirstInsert: false,
}));

vi.mock("@/lib/quotations/settings", () => ({
  getQuotationSettings: vi.fn().mockResolvedValue({
    proforma_prefix: "DF-PI-",
    tax_invoice_prefix: "DF-TI-",
    next_proforma_number: 1001,
    next_tax_invoice_number: 2001,
    default_currency: "INR",
    default_tax_rate: 18,
    company_name: "Deccan Filings",
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      if (state.rpcNumbers === null) return { data: null, error: { code: "PGRST202", message: "not found" } };
      return { data: state.rpcNumbers.shift() ?? null, error: null };
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { account_id: "acc-1", account_role: state.role } }) }) }),
        };
      }
      if (table === "invoices") {
        return {
          insert: (row: Record<string, unknown>) => {
            state.inserted.push({ table, row: { ...row } });
            if (state.dupFirstInsert) {
              state.dupFirstInsert = false;
              return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) }) };
            }
            return { select: () => ({ single: async () => ({ data: { id: "inv-1", ...row }, error: null }) }) };
          },
          update: (u: Record<string, unknown>) => ({ eq: async (_k: string, id: string) => (state.updated.push({ id, ...u }), { error: null }) }),
          delete: () => ({ eq: async (_k: string, id: string) => (state.deleted.push(id), { error: null }) }),
          select: () => ({ eq: () => ({ single: async () => ({ data: { id: "inv-1", ...(state.inserted[0]?.row as object) } }) }) }),
        };
      }
      if (table === "invoice_items") {
        return { insert: async (rows: unknown) => (state.inserted.push({ table, row: rows }), { error: state.itemsError }) };
      }
      if (table === "quotation_settings") {
        return { update: (u: unknown) => ({ eq: async () => (state.settingsUpdates.push(u), { error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "./route";

const base = {
  title: "GST registration",
  client_name: "Ravi Traders",
  client_phone: "919876543210",
  tax_type: "gst",
  tax_rate: 18,
  discount_type: "none",
  discount_value: 0,
  items: [{ title: "GST registration", quantity: 1, unit_price: 2000 }],
};
const post = (body: unknown) => POST(new Request("http://x/api/invoices", { method: "POST", body: JSON.stringify(body) }));
const invoiceRow = () => state.inserted.filter((i) => i.table === "invoices").at(-1)!.row as Record<string, unknown>;

beforeEach(() => {
  state.role = "agent";
  state.inserted = [];
  state.deleted = [];
  state.updated = [];
  state.itemsError = null;
  state.settingsUpdates = [];
  state.rpcNumbers = ["DF-PI-1001", "DF-PI-1002"];
  state.rpcCalls = [];
  state.dupFirstInsert = false;
});

describe("POST /api/invoices — created directly, no quotation", () => {
  it("creates an unpaid proforma with its own number", async () => {
    const res = await post({ ...base, invoice_type: "proforma", due_date: "2026-11-20" });
    expect(res.status).toBe(201);
    const row = invoiceRow();
    expect(row).toMatchObject({
      quotation_id: null,
      invoice_type: "proforma",
      invoice_number: expect.stringContaining("1001"),
      status: "unpaid",
      total_amount: 2360,
      paid_amount: 0,
      balance_amount: 2360,
      payment_method: null,
      paid_at: null,
    });
    // Number comes from the database (migration 075), not a client-side counter write.
    expect(state.rpcCalls).toEqual([{ fn: "next_document_number", args: { p_kind: "proforma" } }]);
    expect(state.settingsUpdates).toHaveLength(0);
  });

  it("creates a paid tax invoice with payment details", async () => {
    state.rpcNumbers = ["DF-TI-2001"];
    await post({ ...base, invoice_type: "tax_invoice", payment_method: "bank_transfer", payment_reference: "UTR123" });
    expect(invoiceRow()).toMatchObject({
      invoice_type: "tax_invoice",
      invoice_number: expect.stringContaining("2001"),
      status: "paid",
      paid_amount: 2360,
      balance_amount: 0,
      payment_method: "bank_transfer",
      payment_reference: "UTR123",
    });
  });

  it("can raise a tax invoice before payment", async () => {
    await post({ ...base, invoice_type: "tax_invoice", payment_received: false, due_date: "2026-11-30" });
    expect(invoiceRow()).toMatchObject({ status: "unpaid", paid_amount: 0, balance_amount: 2360, payment_method: null });
  });

  it("validates input and blocks viewers", async () => {
    expect((await post({ ...base, client_name: " " })).status).toBe(400);
    expect((await post({ ...base, items: [] })).status).toBe(400);
    expect((await post({ ...base, invoice_type: "receipt" })).status).toBe(400);
    state.role = "viewer";
    expect((await post(base)).status).toBe(403);
    expect(state.inserted).toHaveLength(0);
  });

  it("removes the invoice if its line items fail to save (number not used up)", async () => {
    state.itemsError = { message: "boom" };
    const res = await post({ ...base, invoice_type: "proforma" });
    expect(res.status).toBe(500);
    // RLS only lets drafts be deleted: it must be flipped to draft first.
    expect(state.updated).toEqual([{ id: "inv-1", status: "draft" }]);
    expect(state.deleted).toEqual(["inv-1"]);
    expect(state.settingsUpdates).toHaveLength(0);
  });
});

describe("document numbering", () => {
  it("retries with the next number if the number was already taken", async () => {
    state.dupFirstInsert = true;
    const res = await post({ ...base, invoice_type: "proforma" });
    expect(res.status).toBe(201);
    const numbers = state.inserted.filter((i) => i.table === "invoices").map((i) => (i.row as { invoice_number: string }).invoice_number);
    expect(numbers).toEqual(["DF-PI-1001", "DF-PI-1002"]);
  });
  it("falls back to the settings counter until migration 075 is applied", async () => {
    state.rpcNumbers = null;
    const res = await post({ ...base, invoice_type: "proforma" });
    expect(res.status).toBe(201);
    expect(invoiceRow().invoice_number).toBe("DF-PI-1001");
    expect(state.settingsUpdates[0]).toMatchObject({ next_proforma_number: 1002 });
  });
});
