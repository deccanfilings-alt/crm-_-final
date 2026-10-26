import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { format, startOfWeek, startOfMonth } from "date-fns";

const ALLOWED_METRICS = [
  "tasks_completed_on_time",
  "deals_won",
  "quotes_sent",
  "quotes_accepted",
  "amount_collected",
] as const;

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") === "month" ? "month" : "week";
  const userId = searchParams.get("user_id");

  const now = new Date();
  const defaultPeriodStart =
    period === "month"
      ? format(startOfMonth(now), "yyyy-MM-dd")
      : format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");

  const periodStart = searchParams.get("period_start") || defaultPeriodStart;

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  // Non-admins can only view their own targets
  if (userId && userId !== user.id && !["admin", "owner"].includes(profile.account_role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Call the SQL RPC to compute live KPI progress
  const { data: progressRows, error } = await supabase.rpc("kpi_progress", {
    p_account_id: profile.account_id,
    p_period_start: periodStart,
    p_period: period,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let results = (progressRows || []) as any[];

  // Filter by user_id if requested
  if (userId) {
    results = results.filter((r) => r.user_id === userId);
  } else if (!["admin", "owner"].includes(profile.account_role)) {
    results = results.filter((r) => r.user_id === user.id);
  }

  // Fetch profiles for enrichment
  const userIds = Array.from(new Set(results.map((r) => r.user_id)));
  if (userIds.length > 0) {
    const { data: userProfiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, avatar_url, account_role, team")
      .in("user_id", userIds);

    const profileMap = new Map((userProfiles || []).map((p) => [p.user_id, p]));
    results = results.map((r) => ({
      ...r,
      user: profileMap.get(r.user_id) || null,
    }));
  }

  // CEO / Owner protection: Non-owners cannot inspect CEO's employee metrics
  if (profile.account_role !== "owner") {
    results = results.filter((r) => r.user?.account_role !== "owner");
  }

  return NextResponse.json(results);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { user_id, metric, period, period_start, target_value } = body;

    if (!metric || !ALLOWED_METRICS.includes(metric)) {
      return NextResponse.json({ error: "Invalid KPI metric" }, { status: 400 });
    }

    if (!["week", "month"].includes(period)) {
      return NextResponse.json({ error: "Invalid period: must be 'week' or 'month'" }, { status: 400 });
    }

    if (!period_start || isNaN(Date.parse(period_start))) {
      return NextResponse.json({ error: "Invalid period_start date" }, { status: 400 });
    }

    const numericTarget = Number(target_value);
    if (isNaN(numericTarget) || numericTarget < 0) {
      return NextResponse.json({ error: "target_value must be a non-negative number" }, { status: 400 });
    }

    const isAdminOrOwner = ["admin", "owner"].includes(profile.account_role);
    const targetUserId = isAdminOrOwner && user_id ? user_id : user.id;

    // Check target user
    if (targetUserId !== user.id) {
      const { data: targetProfile } = await supabase
        .from("profiles")
        .select("user_id, account_role")
        .eq("user_id", targetUserId)
        .eq("account_id", profile.account_id)
        .maybeSingle();

      if (!targetProfile) {
        return NextResponse.json({ error: "Target member not found in account" }, { status: 400 });
      }

      // Subordinates cannot set targets for the CEO / Owner
      if (targetProfile.account_role === "owner" && profile.account_role !== "owner") {
        return NextResponse.json({ error: "Cannot set targets for company owner" }, { status: 403 });
      }
    }

    // Upsert target
    const { data, error } = await supabase
      .from("kpi_targets")
      .upsert(
        {
          account_id: profile.account_id,
          user_id: targetUserId,
          metric,
          period,
          period_start,
          target_value: numericTarget,
          created_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id,user_id,metric,period,period_start" }
      )
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
