import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { todayIST } from '@/lib/dates';

function verifyCronAuth(request: Request): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
    }

    const authHeader = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${cronSecret}`;
    const suppliedBuf = Buffer.from(authHeader);
    const expectedBuf = Buffer.from(expected);

    if (
      suppliedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(suppliedBuf, expectedBuf)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (cronSecret) {
    const authHeader = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${cronSecret}`;
    const suppliedBuf = Buffer.from(authHeader);
    const expectedBuf = Buffer.from(expected);

    if (
      suppliedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(suppliedBuf, expectedBuf)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return null;
}

export async function POST(request: Request) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const today = todayIST();
  // Cutoff is 3 days ago
  const cutoffDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const admin = supabaseAdmin();

    // Fetch quotations sent >= 3 days ago that are still pending acceptance
    const { data: quotes, error: quotesError } = await admin
      .from('quotations')
      .select('id, account_id, quote_number, title, contact_id, deal_id, created_by_user_id, status, sent_at')
      .eq('status', 'sent')
      .lte('sent_at', cutoffDate);

    if (quotesError) throw quotesError;

    let generatedCount = 0;

    for (const quote of quotes || []) {
      // Check if a follow-up task already exists for this quote
      const { data: existingTasks, error: checkError } = await admin
        .from('action_items')
        .select('id')
        .eq('account_id', quote.account_id)
        .eq('source', 'quotation')
        .ilike('title', `%${quote.quote_number}%`)
        .limit(1);

      if (checkError) {
        console.error('Error checking existing tasks for quote', quote.id, checkError);
        continue;
      }

      if (existingTasks && existingTasks.length > 0) {
        continue; // Already created
      }

      // Determine assignee (creator or account owner/admin fallback)
      let assigneeId = quote.created_by_user_id;
      if (!assigneeId) {
        const { data: profile } = await admin
          .from('profiles')
          .select('user_id')
          .eq('account_id', quote.account_id)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();
        assigneeId = profile?.user_id;
      }

      if (!assigneeId) {
        console.warn('No assignee found for quote', quote.id);
        continue;
      }

      const formattedSentAt = quote.sent_at
        ? new Date(quote.sent_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })
        : '3 days ago';

      const { data: task, error: taskError } = await admin
        .from('action_items')
        .insert({
          account_id: quote.account_id,
          agent_id: assigneeId,
          assignee_id: assigneeId,
          title: `Follow up: Quote ${quote.quote_number} not accepted in 3 days`,
          description: `Quotation "${quote.title}" was sent on ${formattedSentAt} and has not been accepted yet. Please follow up with the client.\n\nQuote ID: ${quote.id}`,
          contact_id: quote.contact_id || null,
          deal_id: quote.deal_id || null,
          priority: 'high',
          status: 'todo',
          target_date: today,
          source: 'quotation',
          requires_review: false,
        })
        .select()
        .single();

      if (taskError) {
        console.error('Failed to create follow-up task for quote', quote.id, taskError);
        continue;
      }

      // Record history
      await admin.from('action_item_history').insert({
        action_item_id: task.id,
        actor_id: assigneeId,
        action: 'created_from_quotation_followup',
        details: {
          quotation_id: quote.id,
          quote_number: quote.quote_number,
          sent_at: quote.sent_at,
        },
      });

      generatedCount++;
    }

    return NextResponse.json({
      success: true,
      processed: (quotes || []).length,
      generated: generatedCount,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
