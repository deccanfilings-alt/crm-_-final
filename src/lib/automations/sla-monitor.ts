import { supabaseAdmin } from './admin-client'
import { runAutomationsForTrigger } from './engine'

export interface SlaEvaluationResult {
  isBreached: boolean
  elapsedMinutes: number
  thresholdMinutes: number
}

/**
 * Pure evaluation function checking if an open conversation has breached its SLA threshold.
 */
export function evaluateConversationSla(conversation: {
  status?: string | null
  last_customer_message_at?: string | Date | null
  last_message_at?: string | Date | null
  sla_breached_at?: string | Date | null
  sla_threshold_minutes?: number | null
}): SlaEvaluationResult {
  const threshold = conversation.sla_threshold_minutes || 30

  if (conversation.status !== 'open' || !conversation.last_customer_message_at) {
    return { isBreached: false, elapsedMinutes: 0, thresholdMinutes: threshold }
  }

  // If already flagged as breached, don't trigger again
  if (conversation.sla_breached_at) {
    return { isBreached: false, elapsedMinutes: 0, thresholdMinutes: threshold }
  }

  const custTime = new Date(conversation.last_customer_message_at).getTime()
  const lastMsgTime = conversation.last_message_at
    ? new Date(conversation.last_message_at).getTime()
    : 0

  // If the last message in conversation is after the last customer message, agent or bot has replied
  if (lastMsgTime > custTime) {
    return { isBreached: false, elapsedMinutes: 0, thresholdMinutes: threshold }
  }

  const elapsedMs = Date.now() - custTime
  const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60))

  return {
    isBreached: elapsedMinutes >= threshold,
    elapsedMinutes,
    thresholdMinutes: threshold,
  }
}

/**
 * Sweeps open conversations in the specified account (or all accounts)
 * and triggers SLA breach automations for any conversations exceeding thresholds.
 */
export async function checkAndTriggerSlaBreaches(targetAccountId?: string): Promise<{
  evaluated: number
  breached: number
  triggered: number
}> {
  const db = supabaseAdmin()

  let query = db
    .from('conversations')
    .select('id, account_id, contact_id, status, last_customer_message_at, last_message_at, sla_breached_at, sla_threshold_minutes')
    .eq('status', 'open')
    .not('last_customer_message_at', 'is', null)
    .is('sla_breached_at', null)

  if (targetAccountId) {
    query = query.eq('account_id', targetAccountId)
  }

  const { data: convs, error } = await query

  if (error || !convs) {
    console.error('[sla-monitor] Failed to query conversations:', error)
    return { evaluated: 0, breached: 0, triggered: 0 }
  }

  let breachedCount = 0
  let triggeredCount = 0

  for (const conv of convs) {
    const { isBreached, elapsedMinutes, thresholdMinutes } = evaluateConversationSla(conv)

    if (isBreached) {
      breachedCount += 1

      // 1. Mark conversation as SLA breached
      const { error: updateErr } = await db
        .from('conversations')
        .update({ sla_breached_at: new Date().toISOString() })
        .eq('id', conv.id)

      if (updateErr) {
        console.error('[sla-monitor] Failed to update sla_breached_at:', updateErr)
        continue
      }

      // 2. Dispatch SLA breach trigger
      try {
        await runAutomationsForTrigger({
          accountId: conv.account_id,
          triggerType: 'sla_breach',
          contactId: conv.contact_id,
          context: {
            conversation_id: conv.id,
            vars: {
              sla_elapsed_minutes: elapsedMinutes,
              sla_threshold_minutes: thresholdMinutes,
            },
          },
        })
        triggeredCount += 1
      } catch (dispatchErr) {
        console.error('[sla-monitor] Failed to dispatch SLA automations:', dispatchErr)
      }
    }
  }

  return {
    evaluated: convs.length,
    breached: breachedCount,
    triggered: triggeredCount,
  }
}
