import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { NextResponse } from "next/server";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id || profile.account_role === 'viewer') {
    return NextResponse.json({ error: "Unauthorized: Viewers cannot delete canned responses" }, { status: 403 });
  }

  const { error } = await supabaseAdmin()
    .from('canned_responses')
    .delete()
    .eq('id', id)
    .eq('account_id', profile.account_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id || profile.account_role === 'viewer') {
    return NextResponse.json({ error: "Unauthorized: Viewers cannot edit canned responses" }, { status: 403 });
  }

  try {
    const { shortcut, content } = await req.json();
    const formattedShortcut = shortcut?.startsWith('/') ? shortcut : shortcut ? `/${shortcut}` : undefined;

    const updates: any = {};
    if (formattedShortcut) updates.shortcut = formattedShortcut;
    if (content) updates.content = content;
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin()
      .from('canned_responses')
      .update(updates)
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
