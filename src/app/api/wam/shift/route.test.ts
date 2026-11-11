import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  rpcError: null as null | { code: string; message: string },
  selectError: null as null | { code: string; message: string },
  openShift: null as null | Record<string, unknown>,
}));

function query(table: string) {
  const filters: Record<string, unknown> = {};
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => ((filters[k] = v), q),
    neq: (k: string, v: unknown) => ((filters[`!${k}`] = v), q),
    gte: () => q,
    order: async () => ({ data: [{ id: "b1", shift_id: "s1", started_at: "2026-11-11T05:00:00Z", ended_at: null }], error: null }),
    maybeSingle: async () => ({ data: state.openShift, error: state.selectError }),
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: table === "wam_shifts" ? [{ total_minutes: 90 }, { total_minutes: 30 }] : [], error: null }),
  };
  return q;
}

vi.mock("@/lib/auth/account", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireRole: async () => ({
      userId: "me",
      accountId: "acc-1",
      role: "agent",
      supabase: {
        from: query,
        rpc: async (fn: string, args?: unknown) => {
          state.rpcCalls.push({ fn, args });
          return { data: null, error: state.rpcError };
        },
      },
    }),
    toErrorResponse: (err: { status?: number; message?: string }) =>
      NextResponse.json({ error: err.message }, { status: err.status ?? 500 }),
  };
});

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  state.rpcCalls = [];
  state.rpcError = null;
  state.selectError = null;
  state.openShift = null;
});

describe("GET /api/wam/shift", () => {
  it("returns clocked-out state with today's completed minutes", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.shift).toBeNull();
    expect(body.breaks).toEqual([]);
    expect(body.today_minutes).toBe(120);
    expect(typeof body.server_now).toBe("string");
  });
  it("includes breaks for an open shift", async () => {
    state.openShift = { id: "s1", status: "paused", clock_in: "2026-11-11T04:00:00Z", clock_out: null };
    const body = await (await GET()).json();
    expect(body.shift.status).toBe("paused");
    expect(body.breaks).toHaveLength(1);
  });
  it("says 503 with a hint when the migration isn't applied", async () => {
    state.selectError = { code: "PGRST205", message: "missing" };
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/072/);
  });
});

describe("POST /api/wam/shift", () => {
  it("runs the transition with server time", async () => {
    const res = await post({ action: "clock_in" });
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toEqual([{ fn: "wam_transition", args: { p_action: "clock_in" } }]);
  });
  it("rejects unknown actions without touching the DB", async () => {
    const res = await post({ action: "set_clock_in", at: "2020-01-01" });
    expect(res.status).toBe(400);
    expect(state.rpcCalls).toHaveLength(0);
  });
  it("maps invalid state and double clock-in to 409", async () => {
    state.rpcError = { code: "22023", message: "You are not on a break" };
    expect((await post({ action: "resume" })).status).toBe(409);
    state.rpcError = { code: "23505", message: "dup" };
    expect((await post({ action: "clock_in" })).status).toBe(409);
  });
});
