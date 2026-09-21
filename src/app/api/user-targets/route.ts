import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const periodType = searchParams.get('period_type'); // 'weekly' | 'quarterly'
  const periodStartDate = searchParams.get('period_start_date'); // date string
  const userId = searchParams.get('user_id'); // to fetch a specific user's targets (for owner view)

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  // If a specific user_id is requested and it's not the current user, ensure they are admin/owner
  if (userId && userId !== user.id && !['admin', 'owner'].includes(profile.account_role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase
    .from('user_targets')
    .select(`
      *,
      agent:profiles!user_targets_user_id_fkey(full_name, avatar_url),
      action_items(id, title, status, estimated_hours)
    `)
    .eq('account_id', profile.account_id)
    .order('created_at', { ascending: true });

  if (periodType) {
    query = query.eq('period_type', periodType);
  }
  if (periodStartDate) {
    query = query.eq('period_start_date', periodStartDate);
  }
  if (userId) {
    query = query.eq('user_id', userId);
  } else if (!['admin', 'owner'].includes(profile.account_role)) {
    // Regular users can only see their own targets by default
    query = query.eq('user_id', user.id);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  try {
    const body = await req.json();
    
    // Validate required fields
    if (!body.title || !body.period_type || !body.period_start_date) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('user_targets')
      .insert({
        account_id: profile.account_id,
        user_id: user.id,
        period_type: body.period_type,
        period_start_date: body.period_start_date,
        title: body.title,
        description: body.description || null,
        status: body.status || 'planned'
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
