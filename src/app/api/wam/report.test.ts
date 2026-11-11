import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "agent" as "owner" | "admin" | "agent" | "viewer",
  filters: [] as Array<{ table: string; k: string; v: unknown }>,
  rpcs: [] as Array<{ fn: string; args: unknown }>,
  rpcError: null as null | { code: string; message: string },
  upserts: [] as unknown[],
}));

function q(table: string) {
  const self: Record<string, unknown> = {};
  const chain = () => self;
  Object.assign(self, {
    select: chain,
    order: chain,
    neq: chain,
    is: chain,
    eq: (k: string, v: unknown) => (state.filters.push({ table, k, v }), self),
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: async (row: unknown) => (state.upserts.push(row), { error: null }),
    then: (r: (v: unknown) => void) => r({ data: table === "profiles" ? [{ user_id: "me" }] : [], error: null }),
  });
  return self;
}

vi.mock("@/lib/auth/account", async () => {
  const { NextResponse } = await import("next/server");
  const rank = { viewer: 1, agent: 2, admin: 3, owner: 4 } as const;
  const ctx = () => ({
    userId: "me",
    accountId: "acc-1",
    role: state.role,
    supabase: {
      from: q,
      rpc: async (fn: string, args: unknown) => (state.rpcs.push({ fn, args }), { data: [], error: state.rpcError }),
    },
  });
  return {
    getCurrentAccount: async () => ctx(),
    requireRole: async (min: keyof typeof rank) => {
      if (rank[state.role] < rank[min]) throw Object.assign(new Error("Forbidden"), { status: 403 });
      return ctx();
    },
    toErrorResponse: (e: { status?: number; message?: string }) => NextResponse.json({ error: e.message }, { status: e.status ?? 500 }),
  };
});

import { GET } from "./report/route";
import { PUT } from "./settings/route";

const get = (qs: string) => GET(new Request(`http://x/api/wam/report${qs}`));
const put = (body: unknown) => PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  state.role = "agent";
  state.filters = [];
  state.rpcs = [];
  state.rpcError = null;
  state.upserts = [];
});

describe("GET /api/wam/report", () => {
  it("limits staff to their own rows", async () => {
    const res = await get("?from=2026-11-01&to=2026-11-11");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.is_admin).toBe(false);
    for (const t of ["profiles", "wam_shifts", "wam_breaks"]) {
      expect(state.filters).toContainEqual({ table: t, k: "user_id", v: "me" });
    }
    expect(state.rpcs).toContainEqual({ fn: "wam_daily", args: { p_from: "2026-11-01", p_to: "2026-11-11" } });
    expect(body.settings).toEqual({ workday_start: "10:00", grace_minutes: 15, min_daily_minutes: 480 });
  });
  it("gives owners/Team Leaders the whole team", async () => {
    state.role = "admin";
    const body = await (await get("?from=2026-11-01&to=2026-11-11")).json();
    expect(body.is_admin).toBe(true);
    expect(state.filters.filter((f) => f.k === "user_id")).toHaveLength(0);
  });
  it("validates the range", async () => {
    expect((await get("?from=2026-11-11&to=2026-11-01")).status).toBe(400);
    expect((await get("?from=2024-01-01&to=2026-01-01")).status).toBe(400);
    expect((await get("?from=bad&to=2026-01-01")).status).toBe(400);
  });
  it("explains a missing migration", async () => {
    state.rpcError = { code: "PGRST202", message: "not found" };
    const res = await get("");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/073/);
  });
});

describe("PUT /api/wam/settings", () => {
  const ok = { workday_start: "09:30", grace_minutes: 10, min_daily_minutes: 510 };
  it("is for owners and Team Leaders only", async () => {
    expect((await put(ok)).status).toBe(403);
    state.role = "owner";
    expect((await put(ok)).status).toBe(200);
    expect(state.upserts[0]).toMatchObject({ account_id: "acc-1", ...ok, updated_by: "me" });
  });
  it("validates input", async () => {
    state.role = "admin";
    expect((await put({ ...ok, workday_start: "25:00" })).status).toBe(400);
    expect((await put({ ...ok, grace_minutes: -1 })).status).toBe(400);
    expect((await put({ ...ok, min_daily_minutes: 2000 })).status).toBe(400);
    expect(state.upserts).toHaveLength(0);
  });
});
