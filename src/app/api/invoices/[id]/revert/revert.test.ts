import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({
  role: "agent" as "owner" | "admin" | "agent" | "viewer",
  calls: [] as Array<{ fn: string; args: unknown }>,
  error: null as null | { code: string; message: string },
}));

vi.mock("@/lib/auth/account", async () => {
  const { NextResponse } = await import("next/server");
  const rank = { viewer: 1, agent: 2, admin: 3, owner: 4 } as const;
  return {
    requireRole: async (min: keyof typeof rank) => {
      if (rank[state.role] < rank[min]) throw Object.assign(new Error("Forbidden"), { status: 403 });
      return {
        userId: "me",
        accountId: "acc-1",
        role: state.role,
        supabase: {
          rpc: async (fn: string, args: unknown) => {
            state.calls.push({ fn, args });
            return state.error
              ? { data: null, error: state.error }
              : { data: { target_type: "quotation", target_id: "q1", target_number: "DF-QT-1001", created: false, cancelled: ["DF-PI-1001"], payment_removed: 0 }, error: null };
          },
        },
      };
    },
    toErrorResponse: (e: { status?: number; message?: string }) => NextResponse.json({ error: e.message }, { status: e.status ?? 500 }),
  };
});

import { POST } from "./route";

const call = (body: unknown, id = ID) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  state.role = "agent";
  state.calls = [];
  state.error = null;
});

describe("POST /api/invoices/:id/revert", () => {
  it("runs the revert in one database call", async () => {
    const res = await call({ to: "quotation", reason: "  Client changed scope " });
    expect(res.status).toBe(200);
    expect((await res.json()).result.target_number).toBe("DF-QT-1001");
    expect(state.calls).toEqual([
      { fn: "revert_billing_document", args: { p_invoice_id: ID, p_to: "quotation", p_reason: "Client changed scope" } },
    ]);
  });
  it("validates input and role", async () => {
    expect((await call({ to: "draft" })).status).toBe(400);
    expect((await call({ to: "quotation" }, "not-a-uuid")).status).toBe(400);
    state.role = "viewer";
    expect((await call({ to: "quotation" })).status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });
  it("maps database errors", async () => {
    state.error = { code: "22023", message: "DF-TI-1001 is already cancelled" };
    const res = await call({ to: "proforma" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already cancelled/);
    state.error = { code: "P0002", message: "x" };
    expect((await call({ to: "proforma" })).status).toBe(404);
    state.error = { code: "PGRST202", message: "x" };
    const missing = await call({ to: "proforma" });
    expect(missing.status).toBe(503);
    expect((await missing.json()).error).toMatch(/074/);
  });
});
