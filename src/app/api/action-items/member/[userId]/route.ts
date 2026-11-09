import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 2000;

/**
 * GET /api/action-items/member/:userId?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Admin/owner drill-down: every action item assigned to one team member
 * (all statuses), optionally limited to a target-date range. Without
 * from/to it returns all of them ("all time"), newest first, capped at
 * MAX_ITEMS with a `truncated` flag.
 */
export async function GET(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }
  if (profile.account_role !== "owner" && profile.account_role !== "admin") {
    return NextResponse.json({ error: "Forbidden: Admins only" }, { status: 403 });
  }

  const { userId } = await params;
  if (!UUID.test(userId)) {
    return NextResponse.json({ error: "Invalid member id" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) {
    return NextResponse.json({ error: "from/to must be YYYY-MM-DD" }, { status: 400 });
  }

  // The member must belong to the caller's account.
  const { data: member } = await supabase
    .from("profiles")
    .select("user_id, full_name, email, avatar_url, team, account_role")
    .eq("user_id", userId)
    .eq("account_id", profile.account_id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Member not found" }, { status: 404 });
  }

  let query = supabase
    .from("action_items")
    .select(`
      *,
      agent:profiles!action_items_agent_id_fkey(full_name, avatar_url, team),
      assignee:profiles!action_items_assignee_id_fkey(full_name, avatar_url, team)
    `)
    .eq("account_id", profile.account_id)
    .eq("assignee_id", userId);
  if (from) query = query.gte("target_date", from);
  if (to) query = query.lte("target_date", to);

  const { data, error } = await query
    .order("target_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MAX_ITEMS + 1);

  if (error) {
    console.error("[action-items/member] query error:", error);
    return NextResponse.json({ error: "Could not load action items" }, { status: 500 });
  }

  const items = data ?? [];
  return NextResponse.json({
    member,
    items: items.slice(0, MAX_ITEMS),
    truncated: items.length > MAX_ITEMS,
  });
}
