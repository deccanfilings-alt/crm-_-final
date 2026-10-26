import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 });
    }

    const accountId = profile.account_id;
    const url = new URL(request.url);
    const search = url.searchParams.get('search')?.trim() || '';
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10)));

    let query = supabase
      .from('contacts')
      .select('id, name, phone, email, company, avatar_url, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (search) {
      const cleanedTerm = search.replace(/[%_]/g, '');
      const pattern = `%${cleanedTerm}%`;
      query = query.or(`name.ilike.${pattern},phone.ilike.${pattern},company.ilike.${pattern},email.ilike.${pattern}`);
    }

    const { data: contacts, error } = await query;

    if (error) {
      console.error('[api/contacts] search error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ contacts: contacts || [] });
  } catch (err: any) {
    console.error('[api/contacts] GET error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
