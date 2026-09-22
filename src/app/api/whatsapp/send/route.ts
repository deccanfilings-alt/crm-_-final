import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  sendInteractiveLocationRequest,
  MetaApiError,
  type MediaKind,
  type InteractiveButton,
  type InteractiveListSection,
} from '@/lib/whatsapp/meta-api'
import { check24HourServiceWindow, parseMetaError } from '@/lib/whatsapp/meta-errors'
import { sendInstagramMessage, sendFacebookMessage } from '@/lib/meta/channels-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import type { MessageTemplate } from '@/types'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      reply_to_message_id,
      is_internal,
      buttons,
      button_label,
      sections,
      header_text,
      footer_text,
      interactive_type,
    } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const
    const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(message_type)

    const VALID_MESSAGE_TYPES = ['text', 'template', 'interactive', ...MEDIA_KINDS] as const
    if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(message_type)) {
      return NextResponse.json(
        { error: `Unsupported message_type "${message_type}"` },
        { status: 400 }
      )
    }

    if (message_type === 'interactive' && (!buttons && !sections && interactive_type !== 'location_request')) {
      return NextResponse.json(
        { error: 'Interactive messages require buttons (1-3), sections (1-10 rows), or interactive_type="location_request"' },
        { status: 400 }
      )
    }

    if (message_type === 'text' && !content_text) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      )
    }

    if (message_type === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      )
    }

    if (isMediaKind && !media_url) {
      return NextResponse.json(
        { error: `media_url is required for ${message_type} messages` },
        { status: 400 }
      )
    }

    if (
      isMediaKind &&
      message_type !== 'audio' &&
      typeof content_text === 'string' &&
      content_text.length > 1024
    ) {
      return NextResponse.json(
        { error: 'Caption exceeds the 1024-character limit' },
        { status: 400 }
      )
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', conversation_id)
      .eq('account_id', accountId)
      .single()

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = conversation.contact
    const channel = conversation.channel || 'whatsapp'
    let sentMessageId = ''

    // --- CHANNEL: INSTAGRAM ---
    if (channel === 'instagram') {
      if (!contact?.instagram_id) {
        return NextResponse.json(
          { error: 'Instagram recipient ID not found for this contact' },
          { status: 400 }
        )
      }

      if (!is_internal) {
        const { data: igConn } = await supabaseAdmin()
          .from('channel_connections')
          .select('access_token')
          .eq('account_id', accountId)
          .eq('channel_type', 'instagram')
          .eq('status', 'connected')
          .maybeSingle()

        if (!igConn?.access_token) {
          return NextResponse.json(
            { error: 'Instagram account not connected in Settings -> Social Channels' },
            { status: 400 }
          )
        }

        let decryptedToken = igConn.access_token
        try {
          decryptedToken = decrypt(decryptedToken)
        } catch {
        }

        const res = await sendInstagramMessage({
          recipientId: contact.instagram_id,
          text: content_text,
          mediaUrl: media_url,
          mediaType: isMediaKind ? message_type : undefined,
          accessToken: decryptedToken,
        })
        sentMessageId = res.messageId
      }
    }

    // --- CHANNEL: FACEBOOK MESSENGER ---
    else if (channel === 'facebook') {
      if (!contact?.facebook_psid) {
        return NextResponse.json(
          { error: 'Facebook recipient ID not found for this contact' },
          { status: 400 }
        )
      }

      if (!is_internal) {
        const { data: fbConn } = await supabaseAdmin()
          .from('channel_connections')
          .select('access_token')
          .eq('account_id', accountId)
          .eq('channel_type', 'facebook')
          .eq('status', 'connected')
          .maybeSingle()

        if (!fbConn?.access_token) {
          return NextResponse.json(
            { error: 'Facebook Page not connected in Settings -> Social Channels' },
            { status: 400 }
          )
        }

        let decryptedToken = fbConn.access_token
        try {
          decryptedToken = decrypt(decryptedToken)
        } catch {
        }

        const res = await sendFacebookMessage({
          recipientId: contact.facebook_psid,
          text: content_text,
          mediaUrl: media_url,
          mediaType: isMediaKind ? message_type : undefined,
          accessToken: decryptedToken,
        })
        sentMessageId = res.messageId
      }
    }

    // --- CHANNEL: WHATSAPP ---
    else {
      if (!contact?.phone) {
        return NextResponse.json(
          { error: 'Contact phone number not found' },
          { status: 400 }
        )
      }

      const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
      if (!isValidE164(sanitizedPhone)) {
        return NextResponse.json(
          { error: 'Invalid phone number format' },
          { status: 400 }
        )
      }

      // Proactive 24-Hour Customer Service Window Guard
      // WhatsApp requires approved templates to message outside the 24h window
      if (message_type !== 'template' && !is_internal) {
        const { data: lastCustomerMsg } = await supabase
          .from('messages')
          .select('created_at')
          .eq('conversation_id', conversation_id)
          .eq('sender_type', 'customer')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const windowCheck = check24HourServiceWindow(lastCustomerMsg?.created_at)
        if (windowCheck.isExpired) {
          return NextResponse.json(
            {
              error:
                'The 24-hour customer service window is closed. Meta requires an approved template message to contact this customer.',
              code: 'WINDOW_EXPIRED',
              isWindowExpired: true,
              action: 'Please select an approved WhatsApp template to re-open the conversation.',
            },
            { status: 400 }
          )
        }
      }

      const { data: config, error: configError } = await supabase
        .from('whatsapp_config')
        .select('*')
        .eq('account_id', accountId)
        .single()

      if (configError || !config) {
        return NextResponse.json(
          { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
          { status: 400 }
        )
      }

      const accessToken = decrypt(config.access_token)

      if (isLegacyFormat(config.access_token)) {
        void supabase
          .from('whatsapp_config')
          .update({ access_token: encrypt(accessToken) })
          .eq('id', config.id)
          .then(({ error }) => {
            if (error) {
              console.warn(
                '[whatsapp/send] access_token GCM upgrade failed:',
                error.message,
              )
            }
          })
      }

      let contextMessageId: string | undefined
      if (reply_to_message_id) {
        const { data: parent, error: parentError } = await supabase
          .from('messages')
          .select('message_id, conversation_id')
          .eq('id', reply_to_message_id)
          .eq('conversation_id', conversation_id)
          .maybeSingle()

        if (parentError || !parent) {
          return NextResponse.json(
            { error: 'reply_to_message_id not found in this conversation' },
            { status: 400 }
          )
        }
        if (!parent.message_id) {
          console.warn(
            '[whatsapp/send] reply target has no Meta message_id; sending without context'
          )
        } else {
          contextMessageId = parent.message_id
        }
      }

      let workingPhone = sanitizedPhone

      if (!is_internal) {
        let templateRow: MessageTemplate | null = null
        if (message_type === 'template' && template_name) {
          const { data } = await supabase
            .from('message_templates')
            .select('*')
            .eq('account_id', accountId)
            .eq('name', template_name)
            .eq('language', template_language || 'en_US')
            .maybeSingle()
          if (data && !isMessageTemplate(data)) {
            return NextResponse.json(
              {
                error:
                  'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
              },
              { status: 500 },
            )
          }
          templateRow = data ?? null
        }

        const attempt = async (phone: string): Promise<string> => {
          if (message_type === 'template') {
            const result = await sendTemplateMessage({
              phoneNumberId: config.phone_number_id,
              accessToken,
              to: phone,
              templateName: template_name,
              language: template_language || 'en_US',
              template: templateRow ?? undefined,
              messageParams: template_message_params ?? undefined,
              params: template_params || [],
              contextMessageId,
            })
            return result.messageId
          }
          if (message_type === 'interactive') {
            if (interactive_type === 'location_request') {
              const result = await sendInteractiveLocationRequest({
                phoneNumberId: config.phone_number_id,
                accessToken,
                to: phone,
                bodyText: content_text || 'Please share your current location with us.',
                contextMessageId,
              })
              return result.messageId
            }
            if (buttons && Array.isArray(buttons) && buttons.length > 0) {
              const result = await sendInteractiveButtons({
                phoneNumberId: config.phone_number_id,
                accessToken,
                to: phone,
                bodyText: content_text || 'Please select an option:',
                headerText: header_text,
                footerText: footer_text,
                buttons: buttons as InteractiveButton[],
                contextMessageId,
              })
              return result.messageId
            }
            if (sections && Array.isArray(sections) && sections.length > 0) {
              const result = await sendInteractiveList({
                phoneNumberId: config.phone_number_id,
                accessToken,
                to: phone,
                bodyText: content_text || 'Please select an option:',
                buttonLabel: button_label || 'View Options',
                headerText: header_text,
                footerText: footer_text,
                sections: sections as InteractiveListSection[],
                contextMessageId,
              })
              return result.messageId
            }
            throw new Error('Interactive message requires buttons or sections')
          }
          if (isMediaKind) {
            const result = await sendMediaMessage({
              phoneNumberId: config.phone_number_id,
              accessToken,
              to: phone,
              kind: message_type as MediaKind,
              link: media_url,
              caption: content_text || undefined,
              filename: filename || undefined,
              contextMessageId,
            })
            return result.messageId
          }
          const result = await sendTextMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: phone,
            text: content_text,
            contextMessageId,
          })
          return result.messageId
        }

        try {
          const variants = phoneVariants(sanitizedPhone)
          let lastError: unknown = null

          for (const variant of variants) {
            try {
              sentMessageId = await attempt(variant)
              workingPhone = variant
              lastError = null
              break
            } catch (err) {
              lastError = err
              const msg = err instanceof Error ? err.message : String(err)
              if (isRecipientNotAllowedError(msg)) {
                continue
              }
              throw err
            }
          }

          if (lastError) throw lastError
        } catch (err) {
          const parsed = parseMetaError(err)
          const message = parsed.userMessage || (err instanceof Error ? err.message : 'Unknown Meta API error')
          console.error('Meta API send failed for all variants:', message)

          const errorDetails: Record<string, unknown> = {
            message,
            code: parsed.numericCode || (err instanceof MetaApiError ? err.code : undefined),
            parsed_code: parsed.code,
            action: parsed.action,
            is_window_expired: parsed.isWindowExpired,
          }
          if (err instanceof MetaApiError) {
            if (err.subcode !== undefined) errorDetails.subcode = err.subcode
            if (err.details) errorDetails.details = err.details
            if (err.fbtraceId) errorDetails.fbtrace_id = err.fbtraceId
          }

          let savedFailedMsg: { id: string } | null = null
          const insertPayload: Record<string, unknown> = {
            conversation_id,
            sender_type: 'agent',
            sender_id: user.id,
            content_type: message_type,
            content_text:
              content_text ||
              (message_type === 'template' ? `[Template: ${template_name}]` : null),
            media_url: media_url || null,
            template_name: template_name || null,
            message_id: null,
            status: 'failed',
            reply_to_message_id: reply_to_message_id || null,
            is_internal: !!is_internal,
            error_details: errorDetails,
          }

          const { data: failedRec, error: insertErr } = await supabase
            .from('messages')
            .insert(insertPayload)
            .select('id')
            .single()

          if (insertErr) {
            if (insertErr.code === '42703' || insertErr.message?.includes('error_details')) {
              delete insertPayload.error_details
              const { data: retryRec } = await supabase
                .from('messages')
                .insert(insertPayload)
                .select('id')
                .single()
              savedFailedMsg = retryRec
            } else {
              console.error('Failed to persist failed message row:', insertErr)
            }
          } else {
            savedFailedMsg = failedRec
          }

          return NextResponse.json(
            {
              error: `Meta API error: ${message}`,
              code: parsed.code,
              action: parsed.action,
              isWindowExpired: parsed.isWindowExpired,
              error_details: errorDetails,
              message_id: savedFailedMsg?.id,
            },
            { status: 502 }
          )
        }
      }

      if (workingPhone !== sanitizedPhone) {
        console.log(
          `[whatsapp/send] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
        )
        await supabase
          .from('contacts')
          .update({ phone: workingPhone })
          .eq('id', contact.id)
      }
    }

    const { data: messageRecord, error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id,
        sender_type: 'agent',
        sender_id: user.id,
        content_type: message_type,
        content_text: content_text || null,
        media_url: media_url || null,
        template_name: template_name || null,
        message_id: sentMessageId || null,
        status: 'sent',
        reply_to_message_id: reply_to_message_id || null,
        is_internal: !!is_internal,
      })
      .select()
      .single()

    if (msgError) {
      console.error('Error inserting sent message:', msgError)
      return NextResponse.json(
        { error: `Message sent to Meta but failed to save to DB: ${msgError.message}` },
        { status: 500 }
      )
    }

    // Update conversation
    await supabase
      .from('conversations')
      .update({
        last_message_text: is_internal
          ? `[Internal Note] ${content_text || `[${message_type}]`}`
          : (content_text || `[${message_type}]`),
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation_id)

    if (!is_internal) {
      // Pause any active Flow run for this contact — the agent stepping
      // in is the strongest "yield, human is here" signal. See PR #2
      // plan for why we pause (not end): preserves diagnostic state +
      // lets the agent or the 24h timeout sweep cleanly resolve the
      // run later. For accounts with no active runs the UPDATE matches
      // zero rows — cheap and harmless.
      try {
        const { error: pauseErr } = await supabaseAdmin()
          .from('flow_runs')
          .update({
            status: 'paused_by_agent',
            ended_at: new Date().toISOString(),
            end_reason: 'agent_replied',
          })
          .eq('account_id', accountId)
          .eq('contact_id', contact.id)
          .eq('status', 'active')
        if (pauseErr) {
          // Best-effort — log + continue. The agent's message already
          // landed at Meta; don't fail the response over a bookkeeping
          // miss. Worst case: a stale active run gets caught by the
          // stale-run cron sweep within 24h.
          console.error('[flows] pause-on-agent-send failed:', pauseErr.message)
        }
      } catch (err) {
        console.error(
          '[flows] pause-on-agent-send threw:',
          err instanceof Error ? err.message : err,
        )
      }
    }

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: sentMessageId,
    })
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
