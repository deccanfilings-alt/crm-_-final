import { createClient } from "@/lib/supabase/server";
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

    const { data, error } = await supabase
      .from('action_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
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

  const { error } = await supabase
    .from('action_items')
    .delete()
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
