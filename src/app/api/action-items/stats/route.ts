import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { format, startOfWeek, addDays } from "date-fns";
import { todayIST } from "@/lib/dates";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  const isAdmin = profile.account_role === 'owner' || profile.account_role === 'admin';
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden: Admins only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const today = todayIST();
  const monDate = startOfWeek(new Date(today), { weekStartsOn: 1 });
  const sunDate = addDays(monDate, 6);

  const p_from = searchParams.get('from') || format(monDate, 'yyyy-MM-dd');
  const p_to = searchParams.get('to') || format(sunDate, 'yyyy-MM-dd');

  const { data, error } = await supabase.rpc('task_stats', {
    p_from,
    p_to,
  });

  if (error) {
    console.error('[action-items/stats] rpc error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const mapped = (data || []).map((row: any) => ({
    user_id: row.user_id,
    full_name: row.full_name,
    team: row.team,
    open_tasks: Number(row.open_tasks ?? row.open_count ?? 0),
    open_count: Number(row.open_tasks ?? row.open_count ?? 0),
    overdue_tasks: Number(row.overdue_tasks ?? row.overdue_count ?? 0),
    overdue_count: Number(row.overdue_tasks ?? row.overdue_count ?? 0),
    due_today: Number(row.due_today ?? row.due_today_count ?? 0),
    due_today_count: Number(row.due_today ?? row.due_today_count ?? 0),
    completed_in_period: Number(row.completed_in_period ?? row.completed_count ?? 0),
    completed_count: Number(row.completed_in_period ?? row.completed_count ?? 0),
    completed_on_time: Number(row.completed_on_time ?? 0),
    avg_days_late: row.avg_days_late !== null ? Number(row.avg_days_late) : null,
    oldest_overdue: row.oldest_overdue || row.oldest_overdue_date || null,
    oldest_overdue_date: row.oldest_overdue || row.oldest_overdue_date || null,
  }));

  return NextResponse.json(mapped);
}
