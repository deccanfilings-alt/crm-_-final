import { supabaseAdmin } from './admin-client'

type AdminClient = ReturnType<typeof supabaseAdmin>

export async function notifyHandoff(
  db: AdminClient,
  input: {
    conversationId: string
    assignedTo?: string | null
    note?: string | null
    reason: 'handoff_node' | 'fallback_exhausted'
  },
): Promise<number> {
  try {
    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('account_id, contact_id, assigned_agent_id, contact:contacts(name, phone)')
      .eq('id', input.conversationId)
      .single()

    if (convErr || !conv) {
      console.error('[notifyHandoff] Failed to load conversation:', convErr)
      return 0
    }

    const contactObj = (Array.isArray(conv.contact) ? conv.contact[0] : conv.contact) as
      | { name?: string | null; phone?: string | null }
      | undefined
    const contactLabel = contactObj?.name || contactObj?.phone || 'Customer'
    const title = `Needs a person: ${contactLabel}`

    const explicitAssignee = input.assignedTo ?? conv.assigned_agent_id
    let recipients: string[] = []

    if (explicitAssignee) {
      recipients = [explicitAssignee]
    } else {
      const { data: teamLeads, error: teamErr } = await db
        .from('profiles')
        .select('user_id')
        .eq('account_id', conv.account_id)
        .in('account_role', ['owner', 'admin'])

      if (teamErr) {
        console.error('[notifyHandoff] Failed to query team leads:', teamErr)
        return 0
      }

      if (teamLeads && Array.isArray(teamLeads)) {
        recipients = teamLeads
          .map((p: { user_id?: string }) => p.user_id)
          .filter((id): id is string => Boolean(id))
      }
    }

    if (recipients.length === 0) {
      return 0
    }

    const rows = recipients.map((userId) => ({
      account_id: conv.account_id,
      user_id: userId,
      type: 'conversation_assigned',
      title,
      body: input.note || 'The assistant handed this conversation to the team.',
      link: `/inbox?c=${input.conversationId}`,
      read: false,
      metadata: {
        conversation_id: input.conversationId,
        reason: input.reason,
      },
    }))

    const { error: insertErr } = await db.from('notifications').insert(rows)
    if (insertErr) {
      console.error('[notifyHandoff] Failed to insert notifications:', insertErr)
      return 0
    }

    return rows.length
  } catch (err) {
    console.error('[notifyHandoff] Unexpected error:', err)
    return 0
  }
}
