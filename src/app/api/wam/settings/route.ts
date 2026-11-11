// ============================================================
// PUT /api/wam/settings — owners / Team Leaders set the attendance
// rule for everyone: office start time, grace minutes, minimum
// daily hours. Body: { workday_start: "HH:MM", grace_minutes,
// min_daily_minutes }.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const start = body.workday_start;
    const grace = Number(body.grace_minutes);
    const min = Number(body.min_daily_minutes);
    if (typeof start !== "string" || !HHMM.test(start)) {
      return NextResponse.json({ error: "Start time must be HH:MM (24-hour)" }, { status: 400 });
    }
    if (!Number.isInteger(grace) || grace < 0 || grace > 240) {
      return NextResponse.json({ error: "Grace period must be 0–240 minutes" }, { status: 400 });
    }
    if (!Number.isInteger(min) || min < 0 || min > 1440) {
      return NextResponse.json({ error: "Minimum hours must be between 0 and 24" }, { status: 400 });
    }

    const { error } = await ctx.supabase.from("wam_settings").upsert(
      {
        account_id: ctx.accountId,
        workday_start: start,
        grace_minutes: grace,
        min_daily_minutes: min,
        updated_by: ctx.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    if (error) {
      console.error("[wam/settings] upsert error:", error);
      return NextResponse.json({ error: "Could not save attendance settings" }, { status: 500 });
    }
    return NextResponse.json({ settings: { workday_start: start, grace_minutes: grace, min_daily_minutes: min } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
