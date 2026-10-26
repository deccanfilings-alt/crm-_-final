import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { todayIST } from '@/lib/dates';
import { findExistingContact, canonicalPhone } from '@/lib/contacts/dedupe';

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    const secret = process.env.WEBHOOK_SECRET;

    if (!secret) {
      return NextResponse.json(
        { error: 'Webhook secret not configured on CRM server' },
        { status: 500 }
      );
    }

    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const {
      event,
      action,
      order_id,
      order_number,
      status,
      reason,
      service_name,
      customer_phone,
      customer_email,
      assignee_id: providedAssigneeId,
      account_id: providedAccountId,
      documents,
    } = body;

    if (!order_id && !order_number) {
      return NextResponse.json(
        { error: 'order_id or order_number is required' },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    // ----------------------------------------------------
    // CASE A: Client uploaded documents -> Auto-complete task
    // ----------------------------------------------------
    const isDocUpload =
      event === 'documents_uploaded' ||
      action === 'documents_uploaded' ||
      status === 'documents_uploaded';

    if (isDocUpload) {
      // Find open action items associated with this order
      const idOrNumber = order_id || order_number;
      const { data: openTasks, error: fetchErr } = await admin
        .from('action_items')
        .select('id, account_id, title')
        .eq('source', 'order')
        .in('status', ['todo', 'in_progress', 'review'])
        .or(`description.ilike.%${idOrNumber}%,title.ilike.%${order_number || order_id}%`);

      if (fetchErr) throw fetchErr;

      const completedIds: string[] = [];
      const now = new Date().toISOString();

      for (const t of openTasks || []) {
        await admin
          .from('action_items')
          .update({
            status: 'completed',
            completed_at: now,
            updated_at: now,
          })
          .eq('id', t.id);

        await admin.from('action_item_history').insert({
          action_item_id: t.id,
          actor_id: null,
          action: 'completed_automatically_by_document_upload',
          details: {
            order_id,
            order_number,
            documents: documents || null,
            completed_at: now,
          },
        });

        completedIds.push(t.id);
      }

      return NextResponse.json({
        success: true,
        action: 'tasks_completed',
        completed_count: completedIds.length,
        task_ids: completedIds,
      });
    }

    // ----------------------------------------------------
    // CASE B: Order moved to "Action Required" -> Create task
    // ----------------------------------------------------
    const isActionRequired =
      status === 'Action Required' ||
      event === 'action_required' ||
      action === 'action_required';

    if (isActionRequired) {
      // 1. Resolve Account ID
      let accountId = providedAccountId;
      if (!accountId) {
        const { data: acc } = await admin
          .from('accounts')
          .select('id')
          .order('created_at', { ascending: true })
          .limit(1)
          .single();
        accountId = acc?.id;
      }

      if (!accountId) {
        return NextResponse.json(
          { error: 'No account found to associate with order' },
          { status: 400 }
        );
      }

      // 2. Resolve Contact ID
      let contactId: string | null = null;
      let contactOwnerId: string | null = null;
      if (customer_phone) {
        const phone = canonicalPhone(customer_phone);
        const match = await findExistingContact(admin, accountId, phone);
        if (match) {
          contactId = match.id;
          const assignedUser = (match as Record<string, any>).assigned_to_user_id;
          contactOwnerId = typeof assignedUser === 'string' ? assignedUser : null;
        }
      }

      // 3. Resolve Assignee ID
      let assigneeId = providedAssigneeId || contactOwnerId;
      if (!assigneeId) {
        const { data: ownerProfile } = await admin
          .from('profiles')
          .select('user_id')
          .eq('account_id', accountId)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();
        assigneeId = ownerProfile?.user_id;
      }

      if (!assigneeId) {
        return NextResponse.json(
          { error: 'No user found in account to assign task to' },
          { status: 400 }
        );
      }

      // 4. Idempotency Check: check if open task already exists for this order
      const idOrNumber = order_id || order_number;
      const { data: existing } = await admin
        .from('action_items')
        .select('id')
        .eq('account_id', accountId)
        .eq('source', 'order')
        .in('status', ['todo', 'in_progress', 'review'])
        .or(`description.ilike.%${idOrNumber}%,title.ilike.%${order_number || order_id}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        return NextResponse.json({
          success: true,
          message: 'Active task for order already exists',
          task_id: existing[0].id,
        });
      }

      // 5. Create action item
      const taskTitle = `Action Required: Order #${order_number || order_id}${
        service_name ? ` - ${service_name}` : ''
      }`;
      const taskDesc = `Website order #${order_number || order_id} moved to Action Required.${
        reason ? `\nDetails: ${reason}` : ''
      }\nOrder ID: ${order_id || order_number}`;

      const { data: task, error: createError } = await admin
        .from('action_items')
        .insert({
          account_id: accountId,
          agent_id: assigneeId,
          assignee_id: assigneeId,
          contact_id: contactId,
          title: taskTitle,
          description: taskDesc,
          priority: 'high',
          status: 'todo',
          target_date: todayIST(),
          source: 'order',
          requires_review: false,
        })
        .select()
        .single();

      if (createError) throw createError;

      // 6. Record History
      await admin.from('action_item_history').insert({
        action_item_id: task.id,
        actor_id: assigneeId,
        action: 'created_from_order',
        details: {
          order_id,
          order_number,
          service_name,
          reason,
          status: 'Action Required',
        },
      });

      return NextResponse.json({
        success: true,
        action: 'task_created',
        task_id: task.id,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Event acknowledged; no task action needed',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
