import { beforeEach, describe, expect, it, vi } from "vitest";

const QID = "33333333-3333-4333-8333-333333333333";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const state = vi.hoisted(() => ({
  role: "agent" as "owner" | "admin" | "agent" | "viewer",
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcError: null as null | { code: string; message: string },
  contactUpdates: [] as unknown[],
  existing: null as null | Record<string, unknown>,
}));

function from(table: string) {
  const q: Record<string, unknown> = {};
  let op = "select";
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    is: () => q,
    update: (p: unknown) => {
      op = "update";
      if (table === "contacts") state.contactUpdates.push(p);
      return q;
    },
    maybeSingle: async () => {
      if (table === "billing_firms") return { data: { id: "firm-1", tax_type: "GST", state: "Telangana", gstin: null }, error: null };
      if (table === "quotations") return { data: state.existing, error: null };
      return { data: null, error: null };
    },
    then: (r: (v: unknown) => void) => r({ data: null, error: null, op }),
  });
  return q;
}

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
          from,
          rpc: async (fn: string, args: Record<string, unknown>) => {
            state.rpc.push({ fn, args });
            return state.rpcError ? { data: null, error: state.rpcError } : { data: { id: QID, quote_number: "DF-QT-1027", status: args.p_doc && (args.p_doc as { status: string }).status }, error: null };
          },
        },
      };
    },
    toErrorResponse: (e: { status?: number; message?: string }) => NextResponse.json({ error: e.message }, { status: e.status ?? 500 }),
  };
});

vi.mock("@/lib/billing/revisions", async (orig) => ({
  ...(await orig<typeof import("@/lib/billing/revisions")>()),
  recordRevision: vi.fn(async () => 2),
}));

import { POST } from "./route";
import { PUT } from "./[id]/route";

const body = {
  status: "final",
  contact_id: CONTACT,
  issue_date: "2026-11-13",
  billed_from: { name: "Deccan Filings", state: "Telangana" },
  billed_to: { name: "Srikanth Ventures LLP", contact_name: "Ali", state: "Telangana", gstin: "36AAAAA0000A1Z5", address: "Banjara Hills" },
  items: [{ title: "TRADE LICENSE", unit_price: 1500, gst_rate: 18 }],
};
const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));
const put = (b: unknown) => PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(b) }), { params: Promise.resolve({ id: QID }) });

beforeEach(() => {
  state.role = "agent";
  state.rpc = [];
  state.rpcError = null;
  state.contactUpdates = [];
  state.existing = { id: QID, account_id: "acc-1", status: "draft", sent_at: null, total_amount: 1770, items: [], accepted_at: null };
});

describe("POST /api/billing/quotations", () => {
  it("computes totals on the server and saves in one call", async () => {
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(state.rpc).toHaveLength(1);
    const { fn, args } = state.rpc[0];
    expect(fn).toBe("billing_save_quotation");
    expect(args.p_id).toBeNull();
    expect(args.p_doc).toMatchObject({ total_amount: 1770, cgst_amount: 135, sgst_amount: 135, client_name: "Ali", client_company: "Srikanth Ventures LLP", status: "final" });
    expect((args.p_items as Array<Record<string, unknown>>)[0]).toMatchObject({ taxable_amount: 1500, tax_amount: 270, line_total: 1770 });
  });
  it("ignores totals sent by the browser", async () => {
    await post({ ...body, total_amount: 1, items: [{ title: "X", unit_price: 1000, gst_rate: 0, line_total: 5 }] });
    expect((state.rpc[0].args.p_doc as { total_amount: number }).total_amount).toBe(1000);
  });
  it("saves the client's billing details back to the contact", async () => {
    await post(body);
    expect(state.contactUpdates[0]).toMatchObject({ address: "Banjara Hills", state: "Telangana", gstin: "36AAAAA0000A1Z5", company: "Srikanth Ventures LLP" });
    state.contactUpdates = [];
    await post({ ...body, save_client_details: false });
    expect(state.contactUpdates).toHaveLength(0);
  });
  it("validation and permission errors", async () => {
    expect((await post({ ...body, items: [] })).status).toBe(400);
    state.role = "viewer";
    expect((await post(body)).status).toBe(403);
    expect(state.rpc).toHaveLength(0);
  });
  it("number already used -> 409 with the database message", async () => {
    state.rpcError = { code: "23505", message: "Number DF-QT-2000 is already used" };
    const res = await post({ ...body, running_no: 2000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/DF-QT-2000/);
  });
});

describe("PUT /api/billing/quotations/:id", () => {
  it("updates a draft", async () => {
    const res = await put(body);
    expect(res.status).toBe(200);
    expect(state.rpc[0].args.p_id).toBe(QID);
  });
  it("refuses invoiced and cancelled quotations", async () => {
    state.existing = { ...state.existing, status: "invoiced" };
    expect((await put(body)).status).toBe(409);
    state.existing = { ...state.existing, status: "cancelled" };
    expect((await put(body)).status).toBe(409);
    expect(state.rpc).toHaveLength(0);
  });
  it("records a revision when the client already has it, and clears acceptance on a price change", async () => {
    state.existing = { ...state.existing, status: "final", sent_at: "2026-11-01T00:00:00Z", accepted_at: "2026-11-02T00:00:00Z", total_amount: 999 };
    const json = await (await put(body)).json();
    expect(json.revision).toBe(2);
    expect(json.reopened).toBe(true);
  });
  it("404 when the quotation doesn't exist", async () => {
    state.existing = null;
    expect((await put(body)).status).toBe(404);
  });
});
