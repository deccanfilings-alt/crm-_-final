import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const contactId = searchParams.get('contact_id');

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 403 });
  }

  let query = supabase
    .from('task_recurrences')
    .select(`
      *,
      contact:contacts(id, name, phone, email),
      assignee:profiles!task_recurrences_assignee_id_fkey(user_id, full_name, avatar_url)
    `)
    .eq('account_id', profile.account_id)
    .order('next_due_date', { ascending: true });

  if (contactId) {
    query = query.eq('contact_id', contactId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();

  if (!profile?.account_id) {
    return NextResponse.json({ error: 'Account not found' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const {
      title,
      description,
      assignee_id,
      priority,
      contact_id,
      frequency,
      day_of_month,
      weekday,
      lead_days,
      next_due_date,
    } = body;

    if (!title || !frequency || !next_due_date) {
      return NextResponse.json(
        { error: 'Missing required fields: title, frequency, next_due_date' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('task_recurrences')
      .insert({
        account_id: profile.account_id,
        created_by: user.id,
        title,
        description: description || null,
        assignee_id: assignee_id || user.id,
        priority: priority || 'medium',
        contact_id: contact_id || null,
        frequency,
        day_of_month: day_of_month || null,
        weekday: weekday ?? null,
        lead_days: lead_days ?? 3,
        next_due_date,
        active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
