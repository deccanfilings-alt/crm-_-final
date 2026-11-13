import { beforeEach, describe, expect, it, vi } from "vitest";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  role: "agent" as "owner" | "admin" | "agent" | "viewer",
  calls: [] as Array<{ id: string; opts: Record<string, unknown> }>,
}));

vi.mock("@/lib/auth/account", async () => {
  const { NextResponse } = await import("next/server");
  const rank = { viewer: 1, agent: 2, admin: 3, owner: 4 } as const;
  return {
    requireRole: async (min: keyof typeof rank) => {
      if (rank[state.role] < rank[min]) throw Object.assign(new Error("Forbidden"), { status: 403 });
      return { userId: "me", accountId: "acc-1", role: state.role, supabase: {} };
    },
    toErrorResponse: (e: { status?: number; message?: string }) => NextResponse.json({ error: e.message }, { status: e.status ?? 500 }),
  };
});

vi.mock("@/lib/billing/convert", () => ({
  convertQuotationToInvoice: vi.fn(async (_db: unknown, _u: string, id: string, opts: Record<string, unknown>) => {
    state.calls.push({ id, opts });
    return id === B ? { ok: false, status: 409, error: "DF-QT-1002 is already invoiced" } : { ok: true, invoice: { id: "inv", invoice_number: "DF-PI-1003" } };
  }),
}));

import { POST } from "./route";

const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));

beforeEach(() => {
  state.role = "agent";
  state.calls = [];
});

describe("POST /api/billing/quotations/convert", () => {
  it("converts each one; a failure doesn't stop the rest", async () => {
    const res = await post({ ids: [A, B, A], invoice_type: "proforma", invoice_date: "2026-11-13", due_days: 7 });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(state.calls.map((c) => c.id)).toEqual([A, B]); // de-duplicated
    expect(state.calls[0].opts).toMatchObject({ invoiceType: "proforma", invoiceDate: "2026-11-13", dueDays: 7 });
    expect(json).toMatchObject({ converted: 1, failed: 1 });
    expect(json.results[1]).toEqual({ id: B, ok: false, error: "DF-QT-1002 is already invoiced" });
  });
  it("validates input and role", async () => {
    expect((await post({ ids: [] })).status).toBe(400);
    expect((await post({ ids: ["not-a-uuid"] })).status).toBe(400);
    expect((await post({ ids: [A], due_days: -1 })).status).toBe(400);
    state.role = "viewer";
    expect((await post({ ids: [A] })).status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });
});
