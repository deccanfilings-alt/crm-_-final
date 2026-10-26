import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { todayIST } from "@/lib/dates";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const targetDate = searchParams.get('date') || todayIST();

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  const overdue = searchParams.get('overdue') === 'true';
  const targetId = searchParams.get('target_id');
  const weekStart = searchParams.get('week_start'); // fetch all plan-linked tasks for a week

  let query = supabase
    .from('action_items')
    .select(`
      *,
      agent:profiles!action_items_agent_id_fkey(full_name, avatar_url),
      assignee:profiles!action_items_assignee_id_fkey(full_name, avatar_url)
    `)
    .eq('account_id', profile.account_id);

  if (targetId) {
    query = query.eq('target_id', targetId);
  } else if (weekStart) {
    // Fetch tasks linked to any goal within this week (target_id is not null, target_date in the week)
    const startDate = new Date(weekStart);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    const weekEnd = endDate.toISOString().split('T')[0];
    query = query.not('target_id', 'is', null)
      .gte('target_date', weekStart)
      .lte('target_date', weekEnd);
  } else if (overdue) {
    query = query.lt('target_date', targetDate).neq('status', 'completed');
  } else {
    query = query.eq('target_date', targetDate);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Sort order: priority (urgent -> low), then due_at (nulls last), then created_at
  const priorityRank: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const sortedData = (data || []).sort((a: any, b: any) => {
    const pDiff = (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2);
    if (pDiff !== 0) return pDiff;
    if (a.due_at && b.due_at) {
      const dDiff = new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      if (dDiff !== 0) return dDiff;
    } else if (a.due_at) {
      return -1;
    } else if (b.due_at) {
      return 1;
    }
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  return NextResponse.json(sortedData);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, full_name')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  try {
    const { title, description, priority, assignee_id, target_date, status, subtasks, contact_id, deal_id, target_id, estimated_hours } = await req.json();
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const tDate = target_date || todayIST();
    const finalAssigneeId = assignee_id || user.id;

    const { data, error } = await supabase
      .from('action_items')
      .insert({
        account_id: profile.account_id,
        agent_id: user.id,
        assignee_id: finalAssigneeId,
        title,
        description: description || null,
        priority: priority || 'normal',
        target_date: tDate,
        status: status || 'todo',
        subtasks: subtasks || [],
        contact_id: contact_id || null,
        deal_id: deal_id || null,
        target_id: target_id || null,
        estimated_hours: estimated_hours || null
      })
      .select()
      .single();

    if (error) throw error;

    if (finalAssigneeId !== user.id) {
      try {
        await supabase.from('notifications').insert({
          account_id: profile.account_id,
          user_id: finalAssigneeId,
          type: 'task_assigned',
          title: `📋 New Task Assigned: "${title}"`,
          body: priority === 'urgent' || priority === 'high'
            ? `Priority: ${priority.toUpperCase()} • Due: ${tDate}`
            : `Assigned by ${profile.full_name || 'a teammate'} • Due: ${tDate}`,
          link: `/action-items?task=${data.id}`,
          read: false,
          metadata: { task_id: data.id, priority, target_date: tDate }
        });
      } catch (notifErr) {
        console.debug('[action-items] Notification insert ignored:', notifErr);
      }
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
