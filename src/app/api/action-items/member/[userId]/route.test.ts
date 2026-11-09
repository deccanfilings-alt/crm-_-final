import { beforeEach, describe, expect, it, vi } from "vitest";

const MEMBER = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  user: { id: "admin-1" } as { id: string } | null,
  caller: { account_id: "acc-1", account_role: "admin" } as Record<string, string> | null,
  member: { user_id: "x", full_name: "Ravi" } as Record<string, unknown> | null,
  items: [] as unknown[],
  itemFilters: [] as Array<[string, string, unknown]>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (table: string) => {
      const filters: Array<[string, string, unknown]> = [];
      const b: Record<string, unknown> = {};
      b.select = () => b;
      for (const m of ["eq", "gte", "lte"]) b[m] = (c: string, v: unknown) => (filters.push([m, c, v]), b);
      b.order = () => b;
      b.limit = async () => {
        state.itemFilters = filters;
        return { data: state.items, error: null };
      };
      b.maybeSingle = async () => {
        // First profiles call is the caller (filtered by user_id = caller id).
        const isCaller = filters.some(([, c, v]) => c === "user_id" && v === state.user?.id);
        return { data: table === "profiles" ? (isCaller ? state.caller : state.member) : null, error: null };
      };
      return b;
    },
  }),
}));

import { GET } from "./route";

const call = (qs = "", id = MEMBER) =>
  GET(new Request(`http://x/api/action-items/member/${id}${qs}`), { params: Promise.resolve({ userId: id }) });

beforeEach(() => {
  state.user = { id: "admin-1" };
  state.caller = { account_id: "acc-1", account_role: "admin" };
  state.member = { user_id: MEMBER, full_name: "Ravi" };
  state.items = [{ id: "t1" }, { id: "t2" }];
  state.itemFilters = [];
});

describe("GET /api/action-items/member/:userId", () => {
  it("returns the member and their items, scoped to the account and assignee", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.member.full_name).toBe("Ravi");
    expect(body.items).toHaveLength(2);
    expect(body.truncated).toBe(false);
    expect(state.itemFilters).toContainEqual(["eq", "account_id", "acc-1"]);
    expect(state.itemFilters).toContainEqual(["eq", "assignee_id", MEMBER]);
  });

  it("applies the target-date range", async () => {
    await call("?from=2026-11-01&to=2026-11-30");
    expect(state.itemFilters).toContainEqual(["gte", "target_date", "2026-11-01"]);
    expect(state.itemFilters).toContainEqual(["lte", "target_date", "2026-11-30"]);
  });

  it("is admin/owner only", async () => {
    state.caller = { account_id: "acc-1", account_role: "agent" };
    expect((await call()).status).toBe(403);
    state.user = null;
    expect((await call()).status).toBe(401);
  });

  it("404s for someone outside the account", async () => {
    state.member = null;
    expect((await call()).status).toBe(404);
  });

  it("validates input", async () => {
    expect((await call("", "nope")).status).toBe(400);
    expect((await call("?from=yesterday")).status).toBe(400);
  });
});
