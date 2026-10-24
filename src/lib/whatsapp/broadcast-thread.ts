import type { SupabaseClient } from '@supabase/supabase-js'
import { renderTemplateBody } from './render-template-body'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

export async function recordBroadcastInThread(
  db: SupabaseClient | any,
  input: {
    accountId: string
    ownerUserId: string
    contactId: string
    wamid: string
    templateName: string
    bodyText?: string | null
    params: string[]
  },
): Promise<void> {
  try {
    // 1. Render the text: renderTemplateBody(bodyText, params), or `[Template: ${templateName}]` if there is no bodyText
    const rendered = input.bodyText
      ? renderTemplateBody(input.bodyText, input.params)
      : `[Template: ${input.templateName}]`

    // 2. Find conversation: where account_id and contact_id match and channel = 'whatsapp', limit 1
    let convId: string | null = null

    const { data: existingConvs, error: findErr } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', input.accountId)
      .eq('contact_id', input.contactId)
      .eq('channel', 'whatsapp')
      .limit(1)

    if (findErr) {
      console.error('[broadcast-thread] Error finding conversation:', findErr)
    }

    if (existingConvs && existingConvs.length > 0) {
      convId = existingConvs[0].id
    } else {
      // 3. If there is none, insert closed conversation
      const now = new Date().toISOString()
      const { data: newConv, error: insertConvErr } = await db
        .from('conversations')
        .insert({
          user_id: input.ownerUserId,
          account_id: input.accountId,
          contact_id: input.contactId,
          channel: 'whatsapp',
          status: 'closed',
          last_message_at: now,
          last_message_text: rendered,
        })
        .select('id')
        .single()

      if (insertConvErr) {
        // If unique violation, re-select
        if (isUniqueViolation(insertConvErr)) {
          const { data: retryConvs } = await db
            .from('conversations')
            .select('id')
            .eq('account_id', input.accountId)
            .eq('contact_id', input.contactId)
            .eq('channel', 'whatsapp')
            .limit(1)
          if (retryConvs && retryConvs.length > 0) {
            convId = retryConvs[0].id
          }
        } else {
          console.error('[broadcast-thread] Error inserting conversation:', insertConvErr)
          return
        }
      } else if (newConv) {
        convId = newConv.id
      }
    }

    if (!convId) {
      console.error('[broadcast-thread] Could not resolve conversation id')
      return
    }

    // 4. Insert into messages:
    const { error: msgErr } = await db.from('messages').insert({
      conversation_id: convId,
      sender_type: 'bot',
      content_type: 'template',
      content_text: rendered,
      template_name: input.templateName,
      message_id: input.wamid,
      status: 'sent',
    })

    if (msgErr) {
      console.error('[broadcast-thread] Error inserting template message:', msgErr)
    }
  } catch (err) {
    console.error('[broadcast-thread] Unexpected error in recordBroadcastInThread:', err)
  }
}
