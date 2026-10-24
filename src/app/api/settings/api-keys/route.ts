import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateApiKey } from '@/lib/auth/agent-auth';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET() {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();

  if (authError || !userData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userData.user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: 'No account found' }, { status: 404 });
  }

  // Allow Team Members (agent), Admins, and Owners to view API keys. Only read-only viewers are restricted.
  if (profile.account_role === 'viewer') {
    return NextResponse.json({ error: 'Forbidden: Viewers cannot manage API keys' }, { status: 403 });
  }

  const { data: keys, error } = await supabaseAdmin()
    .from('api_keys')
    .select('id, name, key_prefix, scopes, is_active, last_used_at, expires_at, created_at')
    .eq('account_id', profile.account_id)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ api_keys: keys || [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();

  if (authError || !userData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userData.user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: 'No account found' }, { status: 404 });
  }

  // Allow Team Members (agent), Admins, and Owners to generate API keys. Only read-only viewers are restricted.
  if (profile.account_role === 'viewer') {
    return NextResponse.json({ error: 'Forbidden: Viewers cannot generate API keys' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { name, scopes, expiresInDays } = body;

    // Name is optional; auto-generate a descriptive label if omitted
    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const keyName =
      name && typeof name === 'string' && name.trim().length > 0
        ? name.trim()
        : `Agent Key (${dateStr})`;

    const created = await generateApiKey({
      accountId: profile.account_id,
      userId: userData.user.id,
      name: keyName,
      scopes: Array.isArray(scopes) && scopes.length > 0 ? scopes : ['all'],
      expiresInDays: typeof expiresInDays === 'number' ? expiresInDays : undefined,
    });

    return NextResponse.json({
      success: true,
      apiKey: created,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate API key' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();

  if (authError || !userData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userData.user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: 'No account found' }, { status: 404 });
  }

  // Allow Team Members (agent), Admins, and Owners to revoke API keys.
  if (profile.account_role === 'viewer') {
    return NextResponse.json({ error: 'Forbidden: Viewers cannot revoke API keys' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Key ID is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin()
      .from('api_keys')
      .delete()
      .eq('id', id)
      .eq('account_id', profile.account_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete API key' },
      { status: 500 }
    );
  }
}
