// ============================================================
// /api/wam/shift — the signed-in user's attendance state.
//
//   GET   → { shift, breaks, today_minutes, server_now }
//           shift = the open (active/paused) shift, or null
//           today_minutes = minutes worked in shifts already
//           completed today (IST); the open shift is added live
//           by the widget.
//   POST  { action: "clock_in" | "start_break" | "resume" | "clock_out" }
//           → runs wam_transition() (server-stamped time) and
//             returns the same payload as GET.
//
// Any signed-in team member can use it (viewer and up).
// ============================================================

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { istDayStart, isWamAction, type WamBreak, type WamShift } from "@/lib/wam/time";

const NOT_INSTALLED = NextResponse.json(
  { error: "Time tracking isn't set up yet — run migration 072_wam_time_tracking.sql in Supabase." },
  { status: 503 },
);

function isMissingSchema(err: { code?: string } | null | undefined) {
  // 42P01 table missing, 42883 function missing, PGRST20x = PostgREST schema cache miss
  return !!err?.code && ["42P01", "42883", "42704", "PGRST202", "PGRST205"].includes(err.code);
}

async function loadState(supabase: SupabaseClient, userId: string) {
  const { data: shift, error } = await supabase
    .from("wam_shifts")
    .select("id, account_id, user_id, clock_in, clock_out, status, total_minutes, break_minutes")
    .eq("user_id", userId)
    .neq("status", "completed")
    .maybeSingle();
  if (error) return { error };

  let breaks: WamBreak[] = [];
  if (shift) {
    const { data, error: bErr } = await supabase
      .from("wam_breaks")
      .select("id, shift_id, started_at, ended_at")
      .eq("shift_id", shift.id)
      .order("started_at");
    if (bErr) return { error: bErr };
    breaks = data ?? [];
  }

  const { data: done, error: dErr } = await supabase
    .from("wam_shifts")
    .select("total_minutes")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gte("clock_in", istDayStart());
  if (dErr) return { error: dErr };
  const today_minutes = (done ?? []).reduce((s, r) => s + (r.total_minutes ?? 0), 0);

  return {
    body: {
      shift: (shift as WamShift | null) ?? null,
      breaks,
      today_minutes,
      server_now: new Date().toISOString(),
    },
  };
}

export async function GET() {
  try {
    const ctx = await requireRole("viewer");
    const res = await loadState(ctx.supabase, ctx.userId);
    if ("error" in res && res.error) {
      if (isMissingSchema(res.error)) return NOT_INSTALLED;
      console.error("[wam] load error:", res.error);
      return NextResponse.json({ error: "Failed to load time tracking" }, { status: 500 });
    }
    return NextResponse.json(res.body);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("viewer");

    const limit = checkRateLimit(`wam:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as { action?: unknown };
    if (!isWamAction(body.action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const { error } = await ctx.supabase.rpc("wam_transition", { p_action: body.action });
    if (error) {
      if (isMissingSchema(error)) return NOT_INSTALLED;
      // 22023 = not valid in current state; 23505 = double clock-in race
      if (error.code === "22023") return NextResponse.json({ error: error.message }, { status: 409 });
      if (error.code === "23505") return NextResponse.json({ error: "You are already clocked in" }, { status: 409 });
      if (error.code === "42501") return NextResponse.json({ error: error.message }, { status: 403 });
      console.error("[wam] transition error:", error);
      return NextResponse.json({ error: "Could not update your shift" }, { status: 500 });
    }

    const res = await loadState(ctx.supabase, ctx.userId);
    if ("error" in res && res.error) {
      console.error("[wam] reload error:", res.error);
      return NextResponse.json({ error: "Saved, but failed to reload" }, { status: 500 });
    }
    return NextResponse.json(res.body);
  } catch (err) {
    return toErrorResponse(err);
  }
}
