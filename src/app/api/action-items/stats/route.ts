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

  return NextResponse.json(data);
}
