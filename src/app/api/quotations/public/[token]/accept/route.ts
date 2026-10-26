import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const admin = supabaseAdmin();

    const { data: quote, error: fetchErr } = await admin
      .from('quotations')
      .select('*, items:quotation_items(*)')
      .eq('public_token', token)
      .single();

    if (fetchErr || !quote) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    const { data: updated, error: updateErr } = await admin
      .from('quotations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', quote.id)
      .select('*, items:quotation_items(*)')
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Insert notification for the account so staff is notified
    try {
      await admin.from('notifications').insert({
        account_id: quote.account_id,
        user_id: quote.created_by_user_id || '00000000-0000-0000-0000-000000000000',
        type: 'system',
        title: `🎉 Quotation ${quote.quote_number} Accepted!`,
        body: `${quote.client_name} accepted quotation "${quote.title}" for ₹${quote.total_amount.toLocaleString('en-IN')}.`,
        link: `/quotations`,
        read: false,
      });
    } catch {
      // Notification insertion is best-effort
    }

    return NextResponse.json({ success: true, quotation: updated });
  } catch (err: any) {
    console.error('[api/quotations/public/accept] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
