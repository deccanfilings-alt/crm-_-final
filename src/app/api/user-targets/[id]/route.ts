import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  // Fetch the existing target to verify tenancy & ownership
  const { data: target } = await supabase
    .from('user_targets')
    .select('id, user_id, account_id')
    .eq('id', id)
    .maybeSingle();

  if (!target || target.account_id !== profile.account_id) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }

  const isAdminOrOwner = ['admin', 'owner'].includes(profile.account_role);
  if (target.user_id !== user.id && !isAdminOrOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { data, error } = await supabase
      .from('user_targets')
      .update(body)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  // Fetch the existing target to verify tenancy & ownership
  const { data: target } = await supabase
    .from('user_targets')
    .select('id, user_id, account_id')
    .eq('id', id)
    .maybeSingle();

  if (!target || target.account_id !== profile.account_id) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }

  const isAdminOrOwner = ['admin', 'owner'].includes(profile.account_role);
  if (target.user_id !== user.id && !isAdminOrOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { error } = await supabase
      .from('user_targets')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
