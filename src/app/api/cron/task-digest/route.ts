import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { format, subDays } from 'date-fns';
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

export async function GET(request: Request) {
  return handleTaskDigest(request);
}

export async function POST(request: Request) {
  return handleTaskDigest(request);
}

async function handleTaskDigest(request: Request) {
  const authErr = verifyCronAuth(request);
  if (authErr) return authErr;

  const { searchParams } = new URL(request.url);
  const slot = searchParams.get('slot') || 'morning';

  const today = todayIST(); // YYYY-MM-DD in Asia/Kolkata

  try {
    if (slot === 'morning') {
      // Skip Sundays for morning digest (rule 5)
      const dayOfWeek = new Date().toLocaleDateString('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
      });
      if (dayOfWeek === 'Sun') {
        return NextResponse.json({ success: true, slot: 'morning', skipped: true, reason: 'Sunday' });
      }

      // Fetch active tasks due today or overdue
      const { data: tasks, error: tasksErr } = await supabaseAdmin()
        .from('action_items')
        .select('id, title, account_id, assignee_id, target_date, status')
        .not('status', 'in', '("completed","cancelled")')
        .lte('target_date', today);

      if (tasksErr) throw tasksErr;

      // Group tasks by assignee
      const byAssignee: Record<string, { account_id: string; tasks: any[] }> = {};
      for (const t of tasks || []) {
        if (!t.assignee_id) continue;
        if (!byAssignee[t.assignee_id]) {
          byAssignee[t.assignee_id] = { account_id: t.account_id, tasks: [] };
        }
        byAssignee[t.assignee_id].tasks.push(t);
      }

      let notificationsSent = 0;
      for (const [assigneeId, { account_id, tasks: userTasks }] of Object.entries(byAssignee)) {
        const dueToday = userTasks.filter((t) => t.target_date === today);
        const overdue = userTasks.filter((t) => t.target_date < today);

        if (dueToday.length === 0 && overdue.length === 0) continue;

        const title = `Your day: ${dueToday.length} tasks today, ${overdue.length} overdue`;
        const topTitles = [...dueToday, ...overdue]
          .slice(0, 3)
          .map((t) => `• ${t.title}`)
          .join('\n');

        await supabaseAdmin().from('notifications').insert({
          account_id,
          user_id: assigneeId,
          type: 'task_assigned',
          title,
          body: topTitles,
          link: '/action-items',
          read: false,
          created_at: new Date().toISOString(),
        });
        notificationsSent++;
      }

      return NextResponse.json({
        success: true,
        slot: 'morning',
        notificationsSent,
      });
    }

    if (slot === 'evening') {
      // 1. Team Evening Summary for Admins & Owners
      // Fetch all tasks relevant to today or overdue
      const { data: allTasks, error: taskErr } = await supabaseAdmin()
        .from('action_items')
        .select('id, title, account_id, assignee_id, target_date, status, assignee:profiles!action_items_assignee_id_fkey(full_name, team)');

      if (taskErr) throw taskErr;

      // Fetch all admins and owners
      const { data: adminProfiles, error: profErr } = await supabaseAdmin()
        .from('profiles')
        .select('user_id, account_id, full_name, team, account_role')
        .in('account_role', ['owner', 'admin']);

      if (profErr) throw profErr;

      // Group tasks by account
      const tasksByAccount: Record<string, any[]> = {};
      for (const t of allTasks || []) {
        if (!tasksByAccount[t.account_id]) tasksByAccount[t.account_id] = [];
        tasksByAccount[t.account_id].push(t);
      }

      let adminSummariesSent = 0;
      const adminsByAccount: Record<string, any[]> = {};
      for (const adm of adminProfiles || []) {
        if (!adminsByAccount[adm.account_id]) adminsByAccount[adm.account_id] = [];
        adminsByAccount[adm.account_id].push(adm);
      }

      for (const [accountId, accAdmins] of Object.entries(adminsByAccount)) {
        const accTasks = tasksByAccount[accountId] || [];
        const dueTodayTasks = accTasks.filter((t) => t.target_date === today);
        const doneTodayTasks = dueTodayTasks.filter((t) => t.status === 'completed');
        const overdueTasks = accTasks.filter(
          (t) => t.target_date < today && t.status !== 'completed' && t.status !== 'cancelled'
        );

        // Calculate who has the most overdue tasks
        const overdueByPerson: Record<string, { name: string; count: number }> = {};
        for (const ot of overdueTasks) {
          const pName = ot.assignee?.full_name || 'Unassigned';
          if (!overdueByPerson[pName]) overdueByPerson[pName] = { name: pName, count: 0 };
          overdueByPerson[pName].count++;
        }
        const mostOverdue = Object.values(overdueByPerson).sort((a, b) => b.count - a.count)[0];

        // Calculate who completed nothing today
        const plannedByPerson: Record<string, { total: number; done: number; name: string }> = {};
        for (const dt of dueTodayTasks) {
          const pName = dt.assignee?.full_name || 'Unassigned';
          if (!plannedByPerson[pName]) plannedByPerson[pName] = { total: 0, done: 0, name: pName };
          plannedByPerson[pName].total++;
          if (dt.status === 'completed') plannedByPerson[pName].done++;
        }
        const zeroDonePeople = Object.values(plannedByPerson)
          .filter((p) => p.total > 0 && p.done === 0)
          .map((p) => p.name);

        const title = `Team today: ${doneTodayTasks.length} of ${dueTodayTasks.length} done, ${overdueTasks.length} overdue`;
        const bodyParts: string[] = [];
        if (mostOverdue) {
          bodyParts.push(`Most overdue: ${mostOverdue.name} (${mostOverdue.count} task${mostOverdue.count > 1 ? 's' : ''})`);
        }
        if (zeroDonePeople.length > 0) {
          bodyParts.push(`Completed nothing today: ${zeroDonePeople.join(', ')}`);
        }
        const body = bodyParts.join('. ') || 'All tasks on track.';

        for (const adm of accAdmins) {
          await supabaseAdmin().from('notifications').insert({
            account_id: accountId,
            user_id: adm.user_id,
            type: 'task_assigned',
            title,
            body,
            link: '/team-action-items',
            read: false,
            created_at: new Date().toISOString(),
          });
          adminSummariesSent++;
        }
      }

      // 2. Escalation (rule 4): open tasks with target_date <= today - 2 days and escalated_at IS NULL
      const twoDaysAgo = format(subDays(new Date(today), 2), 'yyyy-MM-dd');

      const { data: toEscalate, error: escErr } = await supabaseAdmin()
        .from('action_items')
        .select('id, title, account_id, assignee_id, target_date, assignee:profiles!action_items_assignee_id_fkey(full_name, team)')
        .lte('target_date', twoDaysAgo)
        .is('escalated_at', null)
        .not('status', 'in', '("completed","cancelled")');

      if (escErr) throw escErr;

      let escalatedCount = 0;
      for (const task of toEscalate || []) {
        const accAdmins = adminsByAccount[task.account_id] || [];
        const assigneeObj: any = Array.isArray(task.assignee) ? task.assignee[0] : task.assignee;
        const assigneeTeam = assigneeObj?.team?.toLowerCase();

        // Team matching admins or all admins if no team match
        let targetAdmins = accAdmins.filter(
          (a) => a.team && assigneeTeam && a.team.toLowerCase() === assigneeTeam
        );
        if (targetAdmins.length === 0) {
          targetAdmins = accAdmins;
        }

        const assigneeName = assigneeObj?.full_name || 'Unassigned';
        const notifTitle = `Overdue 2+ days: ${task.title} (${assigneeName})`;

        for (const adm of targetAdmins) {
          await supabaseAdmin().from('notifications').insert({
            account_id: task.account_id,
            user_id: adm.user_id,
            type: 'task_assigned',
            title: notifTitle,
            body: `Task is 2+ days overdue and requires escalation.`,
            link: `/team-action-items?task=${task.id}`,
            read: false,
            created_at: new Date().toISOString(),
          });
        }

        // Set escalated_at to ensure it escalates only once
        await supabaseAdmin()
          .from('action_items')
          .update({ escalated_at: new Date().toISOString() })
          .eq('id', task.id);

        escalatedCount++;
      }

      return NextResponse.json({
        success: true,
        slot: 'evening',
        adminSummariesSent,
        escalatedCount,
      });
    }

    return NextResponse.json({ error: `Unknown slot: ${slot}` }, { status: 400 });
  } catch (err: any) {
    console.error('[cron/task-digest] Error:', err);
    return NextResponse.json({ error: err.message || 'Task digest failed' }, { status: 500 });
  }
}
