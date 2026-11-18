import { beforeEach, describe, expect, it, vi } from "vitest";

import { validateDisplayName } from "@/lib/auth/display-name";

const MEMBER = "44444444-4444-4444-8444-444444444444";

const state = vi.hoisted(() => ({
  role: "owner" as "owner" | "admin" | "agent" | "viewer",
  updates: [] as Array<{ values: unknown; filters: Array<[string, unknown]> }>,
  updatedRows: [{ user_id: "x" }] as Array<{ user_id: string }>,
  updateError: null as null | { message: string },
}));

vi.mock("@/lib/auth/account", async () => {
  const { NextResponse } = await import("next/server");
  const rank = { viewer: 1, agent: 2, admin: 3, owner: 4 } as const;
  return {
    requireRole: async (min: keyof typeof rank) => {
      if (rank[state.role] < rank[min]) {
        const e = new Error("Forbidden") as Error & { status: number };
        e.status = 403;
        throw e;
      }
      return {
        userId: "me",
        accountId: "acc-1",
        role: state.role,
        supabase: { rpc: async () => ({ data: null, error: null }) },
      };
    },
    toErrorResponse: (err: { status?: number; message?: string }) =>
      NextResponse.json({ error: err.message }, { status: err.status ?? 500 }),
  };
});

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: (values: unknown) => {
        const entry = { values, filters: [] as Array<[string, unknown]> };
        state.updates.push(entry);
        const chain = {
          eq: (col: string, val: unknown) => {
            entry.filters.push([col, val]);
            return chain;
          },
          select: async () => ({
            data: state.updateError ? null : state.updatedRows,
            error: state.updateError,
          }),
          then: (resolve: (v: unknown) => void) =>
            resolve({ data: null, error: state.updateError }),
        };
        return chain;
      },
    }),
  }),
}));

import { PATCH } from "./members/[userId]/route";

const patch = (body: unknown) =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ userId: MEMBER }),
  });

beforeEach(() => {
  state.role = "owner";
  state.updates = [];
  state.updatedRows = [{ user_id: MEMBER }];
  state.updateError = null;
});

describe("validateDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(validateDisplayName("  Priya \n  Sharma ")).toEqual({ name: "Priya Sharma" });
  });

  it("rejects empty, non-text and over-long names", () => {
    expect(validateDisplayName("   ")).toEqual({ error: "Name can't be empty" });
    expect(validateDisplayName(42)).toEqual({ error: "Name must be text" });
    expect("error" in validateDisplayName("a".repeat(81))).toBe(true);
    expect(validateDisplayName("a".repeat(80))).toEqual({ name: "a".repeat(80) });
  });

  it("rejects control characters", () => {
    expect("error" in validateDisplayName("Bad\u0000Name")).toBe(true);
  });
});

describe("PATCH full_name", () => {
  it("lets an owner rename a member in their own account", async () => {
    const res = await patch({ full_name: "  Priya   Sharma " });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([
      {
        values: { full_name: "Priya Sharma" },
        filters: [
          ["user_id", MEMBER],
          ["account_id", "acc-1"],
        ],
      },
    ]);
  });

  it("refuses admins and lower roles", async () => {
    state.role = "admin";
    const res = await patch({ full_name: "Priya" });
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects an invalid name without writing anything", async () => {
    const res = await patch({ full_name: "   ", team: "accounting" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Name can't be empty");
    expect(state.updates).toHaveLength(0);
  });

  it("returns 404 when the member isn't in the owner's account", async () => {
    state.updatedRows = [];
    const res = await patch({ full_name: "Priya" });
    expect(res.status).toBe(404);
  });

  it("hides database error details", async () => {
    state.updateError = { message: "relation profiles: secret detail" };
    const res = await patch({ full_name: "Priya" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Failed to update name");
  });

  it("still requires at least one field", async () => {
    const res = await patch({});
    expect(res.status).toBe(400);
  });
});
