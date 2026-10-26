import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: 'Server auth configuration missing' }, { status: 500 });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Find user by email
    const { data: usersData, error: listErr } = await adminClient.auth.admin.listUsers();
    if (listErr) {
      console.error('[api/auth/confirm] listUsers error:', listErr);
      return NextResponse.json({ error: listErr.message }, { status: 500 });
    }

    const user = usersData.users.find(
      (u) => u.email?.toLowerCase() === email.trim().toLowerCase()
    );

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Auto-confirm user so they are never blocked by email delivery delays
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(user.id, {
      email_confirm: true,
    });

    if (updateErr) {
      console.error('[api/auth/confirm] updateUserById error:', updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Email confirmed successfully' });
  } catch (err: any) {
    console.error('[api/auth/confirm] unexpected error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
