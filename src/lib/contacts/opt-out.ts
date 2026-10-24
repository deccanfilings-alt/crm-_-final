import type { SupabaseClient } from '@supabase/supabase-js'

const OUT_KEYWORDS = new Set(['stop', 'unsubscribe', 'stop all', 'opt out', 'stop promotions'])
const IN_KEYWORDS = new Set(['start', 'subscribe', 'opt in'])

export function parseOptKeyword(text: string | null | undefined): 'out' | 'in' | null {
  if (!text || typeof text !== 'string') return null
  // Trim, lowercase, strip trailing punctuation
  const cleaned = text.trim().toLowerCase().replace(/[.,!?;:]+$/, '').trim()
  if (OUT_KEYWORDS.has(cleaned)) return 'out'
  if (IN_KEYWORDS.has(cleaned)) return 'in'
  return null
}

export async function setMarketingOptOut(
  db: SupabaseClient | any,
  contactId: string,
  optedOut: boolean
): Promise<void> {
  const { error } = await db
    .from('contacts')
    .update({
      opted_out_marketing: optedOut,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)

  if (error) {
    console.error('[opt-out] Failed to update marketing opt-out:', error)
  }
}

export async function findContactIdForWamid(
  db: SupabaseClient | any,
  wamid: string
): Promise<string | null> {
  if (!wamid) return null

  try {
    // 1. Look in messages: select('conversation:conversations(contact_id)').eq('message_id', wamid).maybeSingle()
    const { data: msg, error: msgErr } = await db
      .from('messages')
      .select('conversation:conversations(contact_id)')
      .eq('message_id', wamid)
      .maybeSingle()

    if (!msgErr && msg) {
      const conv = msg.conversation as any
      const contactId = Array.isArray(conv) ? conv[0]?.contact_id : conv?.contact_id
      if (contactId) return contactId
    }

    // 2. Else look in broadcast_recipients: select('contact_id').eq('whatsapp_message_id', wamid).maybeSingle()
    const { data: recipient, error: recErr } = await db
      .from('broadcast_recipients')
      .select('contact_id')
      .eq('whatsapp_message_id', wamid)
      .maybeSingle()

    if (!recErr && recipient?.contact_id) {
      return recipient.contact_id
    }

    return null
  } catch (err) {
    console.error('[opt-out] Error in findContactIdForWamid:', err)
    return null
  }
}
