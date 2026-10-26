import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  // Find target first to verify permissions
  const { data: target } = await supabase
    .from("kpi_targets")
    .select("id, user_id, created_by, account_id")
    .eq("id", id)
    .eq("account_id", profile.account_id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }

  const isAdminOrOwner = ["admin", "owner"].includes(profile.account_role);
  if (!isAdminOrOwner && target.user_id !== user.id && target.created_by !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await supabase
    .from("kpi_targets")
    .delete()
    .eq("id", id)
    .eq("account_id", profile.account_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: profile } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: "Account not found" }, { status: 403 });
  }

  const { data: target } = await supabase
    .from("kpi_targets")
    .select("id, user_id, created_by, account_id")
    .eq("id", id)
    .eq("account_id", profile.account_id)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }

  const isAdminOrOwner = ["admin", "owner"].includes(profile.account_role);
  if (!isAdminOrOwner && target.user_id !== user.id && target.created_by !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const numericTarget = Number(body.target_value);
    if (isNaN(numericTarget) || numericTarget < 0) {
      return NextResponse.json({ error: "target_value must be a non-negative number" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("kpi_targets")
      .update({
        target_value: numericTarget,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("account_id", profile.account_id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
