import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { todayIST } from '@/lib/dates';
import {
  computeNextDueDate,
  shouldGenerateRecurringTask,
  type RecurrenceFrequency,
} from '@/lib/tasks/recurrence-engine';

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

  try {
    const admin = supabaseAdmin();
    // Fetch all active recurrences
    const { data: recurrences, error } = await admin
      .from('task_recurrences')
      .select('*')
      .eq('active', true);

    if (error) throw error;

    let generatedCount = 0;

    for (const rec of recurrences || []) {
      if (
        shouldGenerateRecurringTask(
          rec.next_due_date,
          rec.lead_days || 0,
          today
        )
      ) {
        // Insert recurring action item
        const { data: task, error: taskError } = await admin.from('action_items')
          .insert({
            account_id: rec.account_id,
            title: rec.title,
            description: rec.description || null,
            assignee_id: rec.assignee_id,
            agent_id: rec.assignee_id,
            contact_id: rec.contact_id || null,
            priority: rec.priority || 'medium',
            status: 'todo',
            target_date: rec.next_due_date,
            source: 'recurring',
          })
          .select()
          .single();

        if (taskError) {
          console.error('Failed to create recurring task for recurrence', rec.id, taskError);
          continue;
        }

        // Record history
        await admin.from('action_item_history').insert({
          action_item_id: task.id,
          actor_id: rec.created_by,
          action: 'created_from_recurrence',
          details: {
            recurrence_id: rec.id,
            frequency: rec.frequency,
            scheduled_due: rec.next_due_date,
          },
        });

        // Compute and advance next_due_date
        const nextDate = computeNextDueDate(
          rec.next_due_date,
          rec.frequency as RecurrenceFrequency,
          rec.day_of_month
        );

        await admin.from('task_recurrences')
          .update({
            next_due_date: nextDate,
            last_generated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', rec.id);

        generatedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      processed: (recurrences || []).length,
      generated: generatedCount,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
