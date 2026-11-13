import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({
  role: "admin" as "owner" | "admin" | "agent" | "viewer",
  series: null as null | Record<string, unknown>,
  existingPeriods: [] as Array<{ id: string }>,
  writes: [] as Array<{ table: string; op: string; payload?: unknown }>,
}));

function table(name: string) {
  const q: Record<string, unknown> = {};
  let op = "select";
  let payload: unknown;
  const done = () => {
    if (op !== "select") state.writes.push({ table: name, op, payload });
    if (name === "billing_series" && op === "select") return { data: state.series, error: null };
    if (name === "billing_series_periods" && op === "select") return { data: state.existingPeriods, error: null };
    return { data: null, error: null };
  };
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    in: () => q,
    update: (p: unknown) => ((op = "update"), (payload = p), q),
    insert: (p: unknown) => ((op = "insert"), (payload = p), q),
    delete: () => ((op = "delete"), q),
    maybeSingle: async () => done(),
    then: (r: (v: unknown) => void) => r(done()),
  });
  return q;
}

vi.mock("@/lib/auth/account", async () => {
  const { NextResponse } = await import("next/server");
  const rank = { viewer: 1, agent: 2, admin: 3, owner: 4 } as const;
  return {
    requireRole: async (min: keyof typeof rank) => {
      if (rank[state.role] < rank[min]) throw Object.assign(new Error("Forbidden"), { status: 403 });
      return { userId: "me", accountId: "acc-1", role: state.role, supabase: { from: table } };
    },
    toErrorResponse: (e: { status?: number; message?: string }) => NextResponse.json({ error: e.message }, { status: e.status ?? 500 }),
  };
});

import { DELETE, PUT } from "./[id]/route";

const put = (body: unknown) =>
  PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });
const del = () => DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  state.role = "admin";
  state.series = { id: ID, firm_id: "f1", doc_type: "quotation", is_default: false };
  state.existingPeriods = [{ id: "p-old" }, { id: "p-keep" }];
  state.writes = [];
});

describe("PUT /api/billing/series/:id", () => {
  it("validates everything before writing anything", async () => {
    const res = await put({ name: "Renamed", periods: [{ prefix: "A" }, { prefix: "B" }] }); // two fallbacks
    expect(res.status).toBe(400);
    expect(state.writes).toHaveLength(0);
  });
  it("updates kept rows, inserts new ones, deletes removed ones", async () => {
    const res = await put({
      periods: [
        { id: "p-keep", prefix: "DF-QT-", starting_no: 1001, next_no: 1027 },
        { prefix: "DF/", suffix: "/26-27", applicable_from: "2026-04-01", applicable_to: "2027-03-31", starting_no: 1 },
      ],
    });
    expect(res.status).toBe(200);
    const ops = state.writes.filter((w) => w.table === "billing_series_periods").map((w) => w.op);
    expect(ops).toEqual(["update", "insert", "delete"]);
  });
  it("switching the default clears the old default first", async () => {
    await put({ is_default: true });
    const seriesWrites = state.writes.filter((w) => w.table === "billing_series");
    expect(seriesWrites.map((w) => w.payload)).toEqual([{ is_default: false }, { is_default: true }]);
  });
  it("is for owners and Team Leaders only", async () => {
    state.role = "agent";
    expect((await put({ name: "x" })).status).toBe(403);
  });
});

describe("DELETE /api/billing/series/:id", () => {
  it("refuses to delete the default series", async () => {
    state.series = { ...state.series, is_default: true };
    expect((await del()).status).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  it("deletes a non-default series", async () => {
    expect((await del()).status).toBe(200);
    expect(state.writes).toEqual([{ table: "billing_series", op: "delete", payload: undefined }]);
  });
});
