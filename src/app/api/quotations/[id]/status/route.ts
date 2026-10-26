import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const body = await request.json();
    const { status } = body;

    const VALID_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status "${status}"` }, { status: 400 });
    }

    const updates: Record<string, any> = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'accepted') updates.accepted_at = new Date().toISOString();
    if (status === 'rejected') updates.rejected_at = new Date().toISOString();
    if (status === 'sent') updates.sent_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('quotations')
      .update(updates)
      .eq('id', id)
      .eq('account_id', profile.account_id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, quotation: updated });
  } catch (err: any) {
    console.error('[api/quotations/[id]/status] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
