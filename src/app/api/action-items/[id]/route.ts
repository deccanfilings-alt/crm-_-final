import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { NextResponse } from "next/server";

const ALLOWED_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'status',
  'priority',
  'assignee_id',
  'target_date',
  'due_at',
  'subtasks',
  'contact_id',
  'deal_id',
  'conversation_id',
  'estimated_hours',
  'cancel_reason',
]);

const ASSIGNEE_ALLOWED_FIELDS = new Set([
  'status',
  'description',
  'subtasks',
  'estimated_hours',
]);

const FORBIDDEN_FIELDS = new Set([
  'account_id',
  'agent_id',
  'id',
  'created_at',
  'source',
]);

const IGNORED_FIELDS = new Set([
  'agent',
  'assignee',
  'events',
]);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 1. Fetch task with joined agent and assignee
  const { data: task, error: taskErr } = await supabase
    .from('action_items')
    .select(`
      *,
      agent:profiles!action_items_agent_id_fkey(full_name, avatar_url),
      assignee:profiles!action_items_assignee_id_fkey(full_name, avatar_url)
    `)
    .eq('id', id)
    .maybeSingle();

  if (taskErr) {
    return NextResponse.json({ error: taskErr.message }, { status: 500 });
  }
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // 2. Fetch history events ordered by created_at ascending
  const { data: events, error: eventsErr } = await supabase
    .from('action_item_events')
    .select('*')
    .eq('action_item_id', id)
    .order('created_at', { ascending: true });

  if (eventsErr) {
    console.error("Failed to fetch action item events:", eventsErr);
  }

  // 3. Resolve actor names and profile references for reassignment/creation
  const userIds = new Set<string>();
  for (const ev of events || []) {
    if (ev.actor_id) userIds.add(ev.actor_id);
    if (ev.event === 'reassigned') {
      if (ev.from_value) userIds.add(ev.from_value);
      if (ev.to_value) userIds.add(ev.to_value);
    } else if (ev.event === 'created' && ev.to_value) {
      userIds.add(ev.to_value);
    }
  }

  const profileMap: Record<string, { full_name: string | null; avatar_url: string | null }> = {};
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, avatar_url')
      .in('user_id', Array.from(userIds));

    if (profiles) {
      for (const p of profiles) {
        profileMap[p.user_id] = { full_name: p.full_name, avatar_url: p.avatar_url };
      }
    }
  }

  const enrichedEvents = (events || []).map((ev: any) => ({
    ...ev,
    actor: ev.actor_id ? (profileMap[ev.actor_id] || { full_name: "Unknown", avatar_url: null }) : null,
    from_profile: ev.from_value && profileMap[ev.from_value] ? profileMap[ev.from_value] : null,
    to_profile: ev.to_value && profileMap[ev.to_value] ? profileMap[ev.to_value] : null,
  }));

  return NextResponse.json({
    ...task,
    events: enrichedEvents,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rawBody = await req.json();

    // Reject attempts to update protected columns
    for (const key of Object.keys(rawBody)) {
      if (FORBIDDEN_FIELDS.has(key)) {
        return NextResponse.json(
          { error: `Cannot modify protected field: ${key}` },
          { status: 400 }
        );
      }
    }

    const updates: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawBody)) {
      if (IGNORED_FIELDS.has(key)) {
        continue;
      }
      if (!ALLOWED_UPDATE_FIELDS.has(key)) {
        return NextResponse.json(
          { error: `Unknown field: ${key}` },
          { status: 400 }
        );
      }
      updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields provided for update" },
        { status: 400 }
      );
    }

    // Load existing task to check permissions and roles
    const { data: existing, error: fetchErr } = await supabase
      .from('action_items')
      .select('id, title, account_id, agent_id, assignee_id, status, target_date, due_at, agent:agent_id(full_name)')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile || profile.account_id !== existing.account_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const isCreator = existing.agent_id === user.id;
    const isAssignee = existing.assignee_id === user.id;
    const isAdmin = profile.account_role === 'owner' || profile.account_role === 'admin';

    if (!isCreator && !isAssignee && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Assignee-only check (neither creator nor admin)
    if (isAssignee && !isCreator && !isAdmin) {
      for (const field of Object.keys(updates)) {
        if (!ASSIGNEE_ALLOWED_FIELDS.has(field)) {
          const creatorName = (existing.agent as any)?.full_name || "the creator";
          return NextResponse.json(
            { error: `Only ${creatorName} or an admin can change this.` },
            { status: 403 }
          );
        }
      }
    }

    // Cancelling rules: only creator or admin may cancel; cancel_reason is required
    if (updates.status === 'cancelled') {
      if (!isCreator && !isAdmin) {
        return NextResponse.json(
          { error: "Only the person who created this task or an admin can cancel it" },
          { status: 403 }
        );
      }
      if (!updates.cancel_reason || typeof updates.cancel_reason !== 'string' || !updates.cancel_reason.trim()) {
        return NextResponse.json(
          { error: "Cancellation reason is required" },
          { status: 400 }
        );
      }
      updates.cancelled_at = new Date().toISOString();
    }

    // Reassigning: if assignee changes, notify the new assignee
    const isReassigned = updates.assignee_id && updates.assignee_id !== existing.assignee_id;

    const { data, error } = await supabase
      .from('action_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (isReassigned) {
      try {
        await supabaseAdmin().from('notifications').insert({
          user_id: updates.assignee_id,
          account_id: existing.account_id,
          type: 'task_assigned',
          title: 'New task assigned to you',
          body: updates.title || existing.title || 'A task was reassigned to you',
          link: `/action-items?task=${id}`,
          read: false,
          created_at: new Date().toISOString(),
        });
      } catch (notifErr) {
        console.error("Failed to insert reassign notification:", notifErr);
      }
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch task to verify delete permissions
  const { data: existing, error: fetchErr } = await supabase
    .from('action_items')
    .select('id, account_id, agent_id, assignee_id')
    .eq('id', id)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || profile.account_id !== existing.account_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isCreator = existing.agent_id === user.id;
  const isAdmin = profile.account_role === 'owner' || profile.account_role === 'admin';

  if (!isCreator && !isAdmin) {
    return NextResponse.json(
      { error: "Ask the person who created this task, or an admin." },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from('action_items')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
