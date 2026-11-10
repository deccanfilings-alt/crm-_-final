// ============================================================
// POST /api/account/step-down
//
// An owner gives up the owner role and becomes an admin. Only
// possible while another owner remains (co-owners, migration 070);
// the account can never be left without an owner.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST() {
  try {
    const ctx = await requireRole("owner");

    const limit = checkRateLimit(
      `admin:stepDown:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await ctx.supabase.rpc("step_down_as_owner");
    if (error) {
      if (error.code === "42501") {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error("[step-down] unexpected RPC error:", error);
      return NextResponse.json({ error: "Failed to step down" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
