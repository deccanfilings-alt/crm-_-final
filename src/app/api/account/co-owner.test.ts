import { beforeEach, describe, expect, it, vi } from "vitest";

const MEMBER = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  role: "owner" as "owner" | "admin" | "agent" | "viewer",
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  rpcError: null as null | { code: string; message: string },
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
        supabase: {
          rpc: async (fn: string, args?: unknown) => {
            state.rpcCalls.push({ fn, args });
            return { data: null, error: state.rpcError };
          },
        },
      };
    },
    toErrorResponse: (err: { status?: number; message?: string }) =>
      NextResponse.json({ error: err.message }, { status: err.status ?? 500 }),
  };
});

vi.mock("@/lib/flows/admin-client", () => ({ supabaseAdmin: () => ({}) }));

import { PATCH } from "./members/[userId]/route";
import { POST as stepDown } from "./step-down/route";

const patch = (body: unknown) =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ userId: MEMBER }),
  });

beforeEach(() => {
  state.role = "owner";
  state.rpcCalls = [];
  state.rpcError = null;
});

describe("make co-owner (PATCH role=owner)", () => {
  it("lets an owner make a member a co-owner", async () => {
    const res = await patch({ role: "owner" });
    expect(res.status).toBe(200);
    expect(state.rpcCalls).toEqual([{ fn: "make_co_owner", args: { p_user_id: MEMBER } }]);
  });

  it("refuses admins", async () => {
    state.role = "admin";
    const res = await patch({ role: "owner" });
    expect(res.status).toBe(403);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it("surfaces database rule errors (e.g. already an owner)", async () => {
    state.rpcError = { code: "22023", message: "This member is already an owner" };
    const res = await patch({ role: "owner" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("This member is already an owner");
  });

  it("still uses set_member_role for normal role changes", async () => {
    state.role = "admin";
    await patch({ role: "agent" });
    expect(state.rpcCalls[0].fn).toBe("set_member_role");
  });
});

describe("POST /api/account/step-down", () => {
  it("calls step_down_as_owner for an owner", async () => {
    const res = await stepDown();
    expect(res.status).toBe(200);
    expect(state.rpcCalls[0].fn).toBe("step_down_as_owner");
  });

  it("blocks the last owner with a clear message", async () => {
    state.rpcError = { code: "22023", message: "You are the only owner. Make someone else a co-owner (or transfer ownership) first." };
    const res = await stepDown();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only owner/);
  });

  it("is owners only", async () => {
    state.role = "admin";
    expect((await stepDown()).status).toBe(403);
    expect(state.rpcCalls).toHaveLength(0);
  });
});
