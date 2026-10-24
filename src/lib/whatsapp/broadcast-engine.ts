import { cleanDisplayName } from '@/lib/contacts/display-name';
import { setMarketingOptOut } from '@/lib/contacts/opt-out';
import { recordBroadcastInThread } from './broadcast-thread';
﻿import { classifyMetaError } from './classifier';
import { SerialRateLimiter, calculateBackoffDelay } from './limiter';
import { validateBroadcastPhone } from './phone-utils';
import { sendTemplateMessage } from './meta-api';
import { decrypt } from './encryption';

export interface ProcessBroadcastOptions {
  isRetryOnly?: boolean;
}

export interface ProcessBroadcastResult {
  success: boolean;
  status: string;
  total: number;
  processed: number;
  sent: number;
  failed: number;
  deferred: number;
  quarantined: number;
  haltedCode?: number;
  haltedReason?: string;
}

/**
 * Checks rolling 24-hour unique recipient phone numbers messaged by this account
 */
export async function getDailyUniqueRecipientCount(
  supabaseAdmin: any,
  accountId: string
): Promise<{ count: number; uniquePhones: Set<string> }> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('broadcast_recipients')
    .select('contact:contacts(phone), sent_at, broadcast:broadcasts!inner(account_id)')
    .eq('broadcast.account_id', accountId)
    .gte('sent_at', cutoff)
    .in('status', ['sent', 'delivered', 'read', 'replied']);

  const uniquePhones = new Set<string>();
  if (!error && data) {
    for (const r of data) {
      const phone = (r.contact as any)?.phone;
      if (phone) {
        const cleaned = phone.replace(/\D/g, '');
        const key = validateBroadcastPhone(phone).sanitized || cleaned;
        if (key) uniquePhones.add(key);
      }
    }
  }

  return { count: uniquePhones.size, uniquePhones };
}

/**
 * Checks marketing template cooldown (default 7 days) and customer opt-outs
 */
export async function isContactSuppressed(
  supabaseAdmin: any,
  accountId: string,
  contactId: string | null | undefined,
  phone: string,
  templateName: string,
  cooldownDays: number = 7
): Promise<{ suppressed: boolean; reason?: string }> {
  if (contactId) {
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('opted_out_marketing')
      .eq('id', contactId)
      .maybeSingle();

    if (contact?.opted_out_marketing) {
      return { suppressed: true, reason: 'Contact opted out of marketing communications' };
    }
  }

  const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000).toISOString();
  
  if (contactId) {
    const { data: recent } = await supabaseAdmin
      .from('broadcast_recipients')
      .select('id, sent_at, broadcast:broadcasts!inner(template_name, account_id)')
      .eq('broadcast.account_id', accountId)
      .eq('broadcast.template_name', templateName)
      .eq('contact_id', contactId)
      .gte('created_at', cutoff)
      .in('status', ['sent', 'delivered', 'read', 'replied'])
      .limit(1);

    if (recent && recent.length > 0) {
      return {
        suppressed: true,
        reason: `Template '${templateName}' was already sent to this contact within ${cooldownDays}-day cooldown`,
      };
    }
  }

  return { suppressed: false };
}

/**
 * Core reliable broadcast processing engine
 */
export async function processBroadcast(
  supabaseAdmin: any,
  broadcastId: string,
  options: ProcessBroadcastOptions = {}
): Promise<ProcessBroadcastResult> {
  // 1. Fetch broadcast
  const { data: broadcast, error: bcError } = await supabaseAdmin
    .from('broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .single();

  if (bcError || !broadcast) {
    throw new Error(`Broadcast not found: ${broadcastId}`);
  }

  const accountId = broadcast.account_id;

  // Update status to sending and update heartbeat
  await supabaseAdmin
    .from('broadcasts')
    .update({ status: 'sending', heartbeat_at: new Date().toISOString() })
    .eq('id', broadcastId);

  // 2. Fetch whatsapp config & decrypt access token
  const { data: config, error: configError } = await supabaseAdmin
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config) {
    await supabaseAdmin
      .from('broadcasts')
      .update({ status: 'failed', halted_reason: 'WhatsApp configuration missing' })
      .eq('id', broadcastId);
    return {
      success: false,
      status: 'failed',
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      deferred: 0,
      quarantined: 0,
      haltedReason: 'WhatsApp configuration missing',
    };
  }

  let accessToken = '';
  try {
    accessToken = decrypt(config.access_token);
  } catch (err) {
    await supabaseAdmin
      .from('broadcasts')
      .update({ status: 'failed', halted_reason: 'Failed to decrypt access token' })
      .eq('id', broadcastId);
    return {
      success: false,
      status: 'failed',
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      deferred: 0,
      quarantined: 0,
      haltedReason: 'Failed to decrypt access token',
    };
  }

  // 3. Fetch template row
  const { data: templateRow } = await supabaseAdmin
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', broadcast.template_name)
    .eq('language', broadcast.template_language || 'en_US')
    .maybeSingle();

  // 4. Fetch recipients
  let query = supabaseAdmin
    .from('broadcast_recipients')
    .select('*, contact:contacts(*)')
    .eq('broadcast_id', broadcastId);

  if (options.isRetryOnly) {
    query = query
      .in('disposition', ['retry', 'defer'])
      .not('status', 'in', '("sent","delivered","read","quarantined")');
  } else {
    query = query.in('status', ['pending', 'queued', 'retrying', 'deferred']);
  }

  const { data: recipients, error: recErr } = await query;
  if (recErr || !recipients || recipients.length === 0) {
    await supabaseAdmin
      .from('broadcasts')
      .update({ status: 'sent', heartbeat_at: new Date().toISOString() })
      .eq('id', broadcastId);

    return {
      success: true,
      status: 'sent',
      total: 0,
      processed: 0,
      sent: 0,
      failed: 0,
      deferred: 0,
      quarantined: 0,
    };
  }

  // Env Configs
  const dailyCap = parseInt(process.env.WHATSAPP_DAILY_UNIQUE_CAP || '250', 10);
  const cooldownDays = parseInt(process.env.WHATSAPP_MARKETING_COOLDOWN_DAYS || '7', 10);
  const sendRate = parseFloat(process.env.WHATSAPP_SEND_RATE_PER_SEC || '2');

  const limiter = new SerialRateLimiter({ ratePerSec: sendRate });
  const initialDaily = await getDailyUniqueRecipientCount(supabaseAdmin, accountId);
  let uniqueCount = initialDaily.count;
  const uniquePhones = initialDaily.uniquePhones;

  let processedCount = 0;
  let sentCount = 0;
  let failedCount = 0;
  let deferredCount = 0;
  let quarantinedCount = 0;
  let isHalted = false;
  let isPaused = false;
  let haltedCode: number | undefined;
  let haltedReason: string | undefined;

  let lastHeartbeat = Date.now();

  for (const recipient of recipients) {
    // Check heartbeat interval
    if (Date.now() - lastHeartbeat > 5000) {
      await supabaseAdmin
        .from('broadcasts')
        .update({ heartbeat_at: new Date().toISOString() })
        .eq('id', broadcastId);
      lastHeartbeat = Date.now();
    }

    const rawPhone = recipient.contact?.phone || recipient.phone;
    
    // 1. Phone validation
    const validation = validateBroadcastPhone(rawPhone);
    if (!validation.isValid) {
      quarantinedCount++;
      failedCount++;
      processedCount++;
      await supabaseAdmin
        .from('broadcast_recipients')
        .update({
          status: 'quarantined',
          disposition: 'quarantined',
          error_message: validation.reason || 'Invalid phone format',
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', recipient.id);
      continue;
    }

    const validPhoneDigits = validation.sanitized;

    // 2. Suppression (Opt-out & Cooldown)
    const suppression = await isContactSuppressed(
      supabaseAdmin,
      accountId,
      recipient.contact_id,
      validPhoneDigits,
      broadcast.template_name,
      cooldownDays
    );

    if (suppression.suppressed) {
      deferredCount++;
      processedCount++;
      await supabaseAdmin
        .from('broadcast_recipients')
        .update({
          status: 'deferred',
          disposition: 'suppressed',
          error_message: suppression.reason,
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', recipient.id);
      continue;
    }

    // 3. Daily Cap Check
    if (!uniquePhones.has(validPhoneDigits) && uniqueCount >= dailyCap) {
      isPaused = true;
      haltedReason = `Daily unique recipient cap reached (${dailyCap}/day)`;
      break;
    }

    // 4. Hoist params computation before retry loop
    const params: string[] = (() => {
      if (Array.isArray(broadcast.template_variables)) return broadcast.template_variables;
      if (Array.isArray(broadcast.template_variables?.params)) return broadcast.template_variables.params;
      if (broadcast.template_variables && typeof broadcast.template_variables === "object") {
        const keys = Object.keys(broadcast.template_variables).sort((a, b) => {
          const an = Number(a); const bn = Number(b);
          if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
          return a.localeCompare(b);
        });
        return keys.map((key) => {
          const v = broadcast.template_variables[key];
          if (!v) return "";
          if (typeof v === "string") return v;
          if (v.type === "static") return v.value || "";
          if (v.type === "field" && recipient.contact) {
            const fieldMap: Record<string, any> = {
              name: cleanDisplayName(recipient.contact.name),
              phone: recipient.contact.phone,
              email: recipient.contact.email,
              company: recipient.contact.company,
            };
            return fieldMap[v.value] || "";
          }
          return "";
        });
      }
      return [];
    })();

    let currentAttempt = (recipient.attempt_count || 0) + 1;
    let messageSent = false;

    while (currentAttempt <= 5 && !messageSent) {
      await limiter.waitNextSlot();

      try {
        const sendResult = await sendTemplateMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: validPhoneDigits,
          templateName: broadcast.template_name,
          language: broadcast.template_language || 'en_US',
          template: templateRow || undefined,
          params,
        });

        messageSent = true;
        sentCount++;
        processedCount++;
        if (!uniquePhones.has(validPhoneDigits)) {
          uniquePhones.add(validPhoneDigits);
          uniqueCount++;
        }

        // Track Attribution: tag contact with last broadcast
        if (recipient.contact?.id) {
          await supabaseAdmin
            .from("contacts")
            .update({ last_broadcast_id: broadcastId })
            .eq("id", recipient.contact.id);
        }

        // Increment broadcast live counter periodically
        if (sentCount % 5 === 0) {
          await supabaseAdmin
            .from("broadcasts")
            .update({
              sent_count: (broadcast.sent_count || 0) + sentCount,
              failed_count: (broadcast.failed_count || 0) + failedCount,
              heartbeat_at: new Date().toISOString(),
            })
            .eq("id", broadcastId);
        }

        await supabaseAdmin
          .from('broadcast_recipients')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            whatsapp_message_id: sendResult.messageId,
            attempt_count: currentAttempt,
            last_attempt_at: new Date().toISOString(),
            disposition: null,
            error_code: null,
            error_message: null,
            error_details: null,
          })
          .eq('id', recipient.id);

        if (recipient.contact_id) {
          await recordBroadcastInThread(supabaseAdmin, {
            accountId: broadcast.account_id,
            ownerUserId: broadcast.user_id,
            contactId: recipient.contact_id,
            wamid: sendResult.messageId,
            templateName: broadcast.template_name,
            bodyText: templateRow?.body_text,
            params,
          });
        }

      } catch (err: any) {
        const httpStatus = err?.status || err?.rawStatus;
        const classified = classifyMetaError(err, httpStatus);

        if (classified.optOut && recipient.contact_id) {
          await setMarketingOptOut(supabaseAdmin, recipient.contact_id, true);
        }

        const retryAfterHeader = err?.headers?.get?.('retry-after') || err?.retryAfter;

        // Persist attempt details
        await supabaseAdmin
          .from('broadcast_recipients')
          .update({
            attempt_count: currentAttempt,
            last_attempt_at: new Date().toISOString(),
            error_code: classified.code || null,
            error_message: classified.message,
            error_details: classified.details || null,
            error_href: classified.href || null,
            raw_response: classified.raw ? (typeof classified.raw === 'object' ? classified.raw : { error: String(classified.raw) }) : null,
          })
          .eq('id', recipient.id);

        if (classified.disposition === 'abort') {
          isHalted = true;
          haltedCode = classified.code;
          haltedReason = `Circuit breaker: ${classified.message}`;
          
          await supabaseAdmin
            .from('broadcast_recipients')
            .update({ status: 'failed', disposition: 'abort' })
            .eq('id', recipient.id);

          failedCount++;
          processedCount++;
          break; // Exit attempt loop & recipient loop
        }

        if (classified.disposition === 'defer') {
          deferredCount++;
          processedCount++;
          await supabaseAdmin
            .from('broadcast_recipients')
            .update({ status: 'deferred', disposition: 'defer' })
            .eq('id', recipient.id);
          break; // Do not retry inside same run
        }

        if (classified.disposition === 'fail') {
          failedCount++;
          processedCount++;
          await supabaseAdmin
            .from('broadcast_recipients')
            .update({ status: 'failed', disposition: 'fail' })
            .eq('id', recipient.id);
          break; // Single row failure, do not retry
        }

        if (classified.disposition === 'retry') {
          if (currentAttempt >= 5) {
            failedCount++;
            processedCount++;
            await supabaseAdmin
              .from('broadcast_recipients')
              .update({
                status: 'failed',
                disposition: 'fail',
                error_message: `Max attempts (5) exhausted: ${classified.message}`,
              })
              .eq('id', recipient.id);
            break;
          }

          // Calculate delay with full jitter
          const delayMs = calculateBackoffDelay(currentAttempt, retryAfterHeader);
          const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();

          await supabaseAdmin
            .from('broadcast_recipients')
            .update({
              status: 'retrying',
              disposition: 'retry',
              next_attempt_at: nextAttemptAt,
            })
            .eq('id', recipient.id);

          limiter.penalize(delayMs);
          currentAttempt++;
        }
      }
    }

    if (isHalted) break;
  }

  // Update final broadcast status
  let finalStatus = 'sent';
  if (isHalted) {
    finalStatus = 'halted';
  } else if (isPaused) {
    finalStatus = 'paused';
  } else if (sentCount === 0 && failedCount > 0) {
    finalStatus = 'failed';
  }

  await supabaseAdmin
    .from('broadcasts')
    .update({
      status: finalStatus,
      sent_count: (broadcast.sent_count || 0) + sentCount,
      failed_count: (broadcast.failed_count || 0) + failedCount,
      halted_code: haltedCode || null,
      halted_reason: haltedReason || null,
      heartbeat_at: new Date().toISOString(),
    })
    .eq('id', broadcastId);

  return {
    success: !isHalted,
    status: finalStatus,
    total: recipients.length,
    processed: processedCount,
    sent: sentCount,
    failed: failedCount,
    deferred: deferredCount,
    quarantined: quarantinedCount,
    haltedCode,
    haltedReason,
  };
}
