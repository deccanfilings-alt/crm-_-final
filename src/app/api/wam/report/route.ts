// ============================================================
// GET /api/wam/report?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Attendance & productivity for the Attendance page.
// Owners / Team Leaders get the whole team; everyone else gets only
// their own timesheet (scoping is enforced in the SQL functions and
// RLS, migrations 072/073 — this route doesn't widen anything).
//
// → { is_admin, me, settings, members, daily, productivity,
//     live: { shifts, breaks, today }, today, server_now }
// ============================================================

import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { DEFAULT_WAM_SETTINGS, istDate, normalizeHHMM, type WamSettings } from "@/lib/wam/report";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

function isMissingSchema(err: { code?: string } | null | undefined) {
  return !!err?.code && ["42P01", "42883", "42704", "PGRST202", "PGRST205"].includes(err.code);
}

const NOT_INSTALLED = () =>
  NextResponse.json(
    { error: "Attendance reports aren't set up yet — run migration 073_wam_reports.sql in Supabase." },
    { status: 503 },
  );

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const isAdmin = hasMinRole(ctx.role, "admin");

    const sp = new URL(request.url).searchParams;
    const today = istDate();
    const from = sp.get("from") ?? today;
    const to = sp.get("to") ?? today;
    if (!DATE.test(from) || !DATE.test(to) || from > to) {
      return NextResponse.json({ error: "from/to must be YYYY-MM-DD with from ≤ to" }, { status: 400 });
    }
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days > MAX_DAYS) {
      return NextResponse.json({ error: `Pick a range of at most ${MAX_DAYS} days` }, { status: 400 });
    }

    const db = ctx.supabase;
    let membersQ = db
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, account_role, team")
      .eq("account_id", ctx.accountId)
      .order("full_name");
    if (!isAdmin) membersQ = membersQ.eq("user_id", ctx.userId);

    let shiftsQ = db.from("wam_shifts").select("user_id, status, clock_in").neq("status", "completed");
    let breaksQ = db.from("wam_breaks").select("user_id, started_at").is("ended_at", null);
    if (!isAdmin) {
      shiftsQ = shiftsQ.eq("user_id", ctx.userId);
      breaksQ = breaksQ.eq("user_id", ctx.userId);
    }

    const [members, settings, daily, productivity, todayRows, openShifts, openBreaks] = await Promise.all([
      membersQ,
      db.from("wam_settings").select("workday_start, grace_minutes, min_daily_minutes").eq("account_id", ctx.accountId).maybeSingle(),
      db.rpc("wam_daily", { p_from: from, p_to: to }),
      db.rpc("wam_productivity", { p_from: from, p_to: to }),
      db.rpc("wam_daily", { p_from: today, p_to: today }),
      shiftsQ.eq("account_id", ctx.accountId),
      breaksQ.eq("account_id", ctx.accountId),
    ]);

    const errors = [members, settings, daily, productivity, todayRows, openShifts, openBreaks].map((r) => r.error).filter(Boolean);
    if (errors.some(isMissingSchema)) return NOT_INSTALLED();
    if (errors.length) {
      console.error("[wam/report] query errors:", errors);
      return NextResponse.json({ error: "Could not load the attendance report" }, { status: 500 });
    }

    const s: WamSettings = settings.data
      ? {
          workday_start: normalizeHHMM(settings.data.workday_start),
          grace_minutes: settings.data.grace_minutes,
          min_daily_minutes: settings.data.min_daily_minutes,
        }
      : DEFAULT_WAM_SETTINGS;

    return NextResponse.json({
      is_admin: isAdmin,
      me: ctx.userId,
      range: { from, to },
      today,
      settings: s,
      members: members.data ?? [],
      daily: daily.data ?? [],
      productivity: productivity.data ?? [],
      live: { shifts: openShifts.data ?? [], breaks: openBreaks.data ?? [], today: todayRows.data ?? [] },
      server_now: new Date().toISOString(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
