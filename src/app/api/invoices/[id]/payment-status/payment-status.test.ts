import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({
  role: "agent" as "owner" | "admin" | "agent" | "viewer",
  invoice: null as null | Record<string, unknown>,
  activeTaxInvoice: null as null | { id: string; invoice_number: string },
  updates: [] as Array<Record<string, unknown>>,
}));

function invoicesTable() {
  let mode: "load" | "ti" = "load";
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: (k: string) => {
      if (k === "source_invoice_id") mode = "ti";
      return q;
    },
    neq: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: mode === "ti" ? state.activeTaxInvoice : state.invoice, error: null }),
    update: (u: Record<string, unknown>) => {
      state.updates.push(u);
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        eq: () => chain,
        select: () => chain,
        single: async () => ({ data: { ...state.invoice, ...u }, error: null }),
      });
      return chain;
    },
  });
  return q;
}

vi.mock("@/lib/auth/account", async () => {
  const { NextResponse } = await import("next/server");
  const rank = { viewer: 1, agent: 2, admin: 3, owner: 4 } as const;
  return {
    requireRole: async (min: keyof typeof rank) => {
      if (rank[state.role] < rank[min]) throw Object.assign(new Error("Forbidden"), { status: 403 });
      return { userId: "me", accountId: "acc-1", role: state.role, supabase: { from: () => invoicesTable() } };
    },
    toErrorResponse: (e: { status?: number; message?: string }) => NextResponse.json({ error: e.message }, { status: e.status ?? 500 }),
  };
});

import { POST } from "./route";

const call = (body: unknown) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  state.role = "agent";
  state.invoice = { id: ID, invoice_type: "proforma", invoice_number: "DF-PI-1002", status: "unpaid", total_amount: 2950, paid_amount: 0, paid_at: null, payment_method: null };
  state.activeTaxInvoice = null;
  state.updates = [];
});

describe("POST /api/invoices/:id/payment-status", () => {
  it("marks paid with the full amount", async () => {
    const res = await call({ status: "paid" });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ status: "paid", paid_amount: 2950, balance_amount: 0 });
  });
  it("partially paid needs a valid amount", async () => {
    expect((await call({ status: "partially_paid" })).status).toBe(400);
    expect((await call({ status: "partially_paid", paid_amount: 5000 })).status).toBe(400);
    const ok = await call({ status: "partially_paid", paid_amount: 1000 });
    expect(ok.status).toBe(200);
    expect(state.updates.at(-1)).toMatchObject({ paid_amount: 1000, balance_amount: 1950 });
  });
  it("won't mark a proforma unpaid while its tax invoice is active", async () => {
    state.invoice = { ...state.invoice, status: "paid", paid_amount: 2950 };
    state.activeTaxInvoice = { id: "ti-1", invoice_number: "DF-TI-1001" };
    const res = await call({ status: "unpaid" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "has_tax_invoice", tax_invoice_id: "ti-1" });
    expect(state.updates).toHaveLength(0);
  });
  it("validates status, role and cancelled documents", async () => {
    expect((await call({ status: "cancelled" })).status).toBe(400);
    state.invoice = { ...state.invoice, status: "cancelled" };
    expect((await call({ status: "paid" })).status).toBe(400);
    state.role = "viewer";
    expect((await call({ status: "paid" })).status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });
});
