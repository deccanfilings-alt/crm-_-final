import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: taskId } = await params;

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  // Verify task belongs to this account
  const { data: task } = await supabase
    .from("action_items")
    .select("id, account_id")
    .eq("id", taskId)
    .eq("account_id", profile.account_id)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const { data: comments, error } = await supabase
    .from("task_comments")
    .select(`
      id,
      action_item_id,
      author_id,
      body,
      attachments,
      created_at,
      updated_at,
      author:profiles!task_comments_author_id_fkey(user_id, full_name, avatar_url, account_role)
    `)
    .eq("action_item_id", taskId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(comments || []);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: taskId } = await params;

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, full_name")
    .eq("user_id", user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  // Verify task
  const { data: task, error: taskErr } = await supabase
    .from("action_items")
    .select("id, title, account_id, assignee_id, agent_id")
    .eq("id", taskId)
    .eq("account_id", profile.account_id)
    .maybeSingle();

  if (taskErr || !task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  try {
    const { body, attachments } = await req.json();

    if (!body || !body.trim()) {
      return NextResponse.json({ error: "Comment body cannot be empty" }, { status: 400 });
    }

    // Insert comment
    const { data: comment, error: commentErr } = await supabase
      .from("task_comments")
      .insert({
        action_item_id: taskId,
        author_id: user.id,
        body: body.trim(),
        attachments: Array.isArray(attachments) ? attachments : [],
      })
      .select(`
        id,
        action_item_id,
        author_id,
        body,
        attachments,
        created_at,
        updated_at,
        author:profiles!task_comments_author_id_fkey(user_id, full_name, avatar_url, account_role)
      `)
      .single();

    if (commentErr) throw commentErr;

    // Record in audit history
    await supabase.from("action_item_history").insert({
      action_item_id: taskId,
      actor_id: user.id,
      action: "comment_added",
      details: {
        comment_id: comment.id,
        snippet: body.slice(0, 100),
      },
    });

    // Notify assignee and creator if distinct from author
    const recipients = new Set<string>();
    if (task.assignee_id && task.assignee_id !== user.id) {
      recipients.add(task.assignee_id);
    }
    if (task.agent_id && task.agent_id !== user.id) {
      recipients.add(task.agent_id);
    }

    if (recipients.size > 0) {
      const authorName = profile.full_name || "A team member";
      const snippet = body.length > 80 ? body.slice(0, 80) + "..." : body;
      const notifications = Array.from(recipients).map((recipientId) => ({
        account_id: profile.account_id,
        user_id: recipientId,
        type: "task_comment",
        title: `${authorName} commented on task`,
        body: `"${task.title}": ${snippet}`,
        link: `/action-items?task=${task.id}`,
        read: false,
      }));

      try { await supabase.from("notifications").insert(notifications); } catch {}
    }

    return NextResponse.json(comment);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
