import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

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

export async function GET(request: Request) {
  return handleTaskReminders(request);
}

export async function POST(request: Request) {
  return handleTaskReminders(request);
}

async function handleTaskReminders(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  try {
    const now = new Date();
    const in60Minutes = new Date(now.getTime() + 60 * 60 * 1000);

    const { data: dueTasks, error: fetchErr } = await supabaseAdmin()
      .from('action_items')
      .select('id, title, account_id, assignee_id, due_at')
      .not('status', 'in', '("completed","cancelled")')
      .is('reminded_at', null)
      .gte('due_at', now.toISOString())
      .lte('due_at', in60Minutes.toISOString());

    if (fetchErr) throw fetchErr;

    if (!dueTasks || dueTasks.length === 0) {
      return NextResponse.json({ success: true, remindersSent: 0 });
    }

    let remindersSent = 0;
    for (const task of dueTasks) {
      if (!task.assignee_id) continue;

      const timeFormatted = new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
        .format(new Date(task.due_at))
        .toLowerCase();

      const title = `Due at ${timeFormatted}: ${task.title}`;

      await supabaseAdmin().from('notifications').insert({
        account_id: task.account_id,
        user_id: task.assignee_id,
        type: 'task_assigned',
        title,
        body: `Task deadline is approaching at ${timeFormatted}.`,
        link: `/action-items?task=${task.id}`,
        read: false,
        created_at: new Date().toISOString(),
      });

      // Mark reminded_at to ensure it isn't sent twice
      await supabaseAdmin()
        .from('action_items')
        .update({ reminded_at: new Date().toISOString() })
        .eq('id', task.id);

      remindersSent++;
    }

    return NextResponse.json({
      success: true,
      remindersSent,
    });
  } catch (err: any) {
    console.error('[cron/task-reminders] Error:', err);
    return NextResponse.json({ error: err.message || 'Task reminders failed' }, { status: 500 });
  }
}
