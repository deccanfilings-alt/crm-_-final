import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();
    
  if (!profile?.account_id) {
    return NextResponse.json({ error: "No account found" }, { status: 403 });
  }

  const { data, error } = await supabaseAdmin()
    .from('canned_responses')
    .select('*')
    .eq('account_id', profile.account_id)
    .order('shortcut', { ascending: true });

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
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id || profile.account_role === 'viewer') {
    return NextResponse.json({ error: "Unauthorized: Viewers cannot create canned responses" }, { status: 403 });
  }

  try {
    const { shortcut, content } = await req.json();
    if (!shortcut || !content) {
      return NextResponse.json({ error: "Shortcut and content are required" }, { status: 400 });
    }

    const formattedShortcut = shortcut.startsWith('/') ? shortcut : `/${shortcut}`;

    const { data, error } = await supabaseAdmin()
      .from('canned_responses')
      .insert({
        account_id: profile.account_id,
        shortcut: formattedShortcut,
        content,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}