import { supabaseAdmin } from '@/lib/flows/admin-client';
import { engineSendText, engineSendTemplate } from '@/lib/automations/meta-send';
// phone-utils
import { findExistingContact, canonicalPhone } from '@/lib/contacts/dedupe';
import type { MCPToolCallParams, MCPToolResult } from './types';

export const CONTACT_RELATIONS =
  'contact_tags(tags(name)), contact_custom_values(value, custom_fields(field_name))';
export const MESSAGE_COLUMNS =
  'id, sender_type, sender_id, content_type, content_text, media_url, template_name, message_id, status, is_internal, created_at';

export function flattenContact(row: any) {
  if (!row) return row;
  const { contact_tags, contact_custom_values, ...rest } = row;
  const tags: string[] = (contact_tags || [])
    .map((ct: any) => ct?.tags?.name)
    .filter((n: any): n is string => Boolean(n));

  const custom_fields: Record<string, string | null> = {};
  for (const ccv of (contact_custom_values || [])) {
    const fieldName = ccv?.custom_fields?.field_name;
    if (fieldName) {
      custom_fields[fieldName] = ccv?.value ?? null;
    }
  }

  return {
    ...rest,
    tags,
    custom_fields,
  };
}

export function toDbConversationStatus(s: string | null | undefined): string {
  if (!s) return 'open';
  const lower = String(s).trim().toLowerCase();
  if (lower === 'resolved') return 'closed';
  return lower;
}

export function sanitizeSearchTerm(q: string): string {
  if (!q) return '';
  return q.replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function resolveActingUserId(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  userId?: string | null
): Promise<string | null> {
  if (userId) return userId;
  const { data: acc } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  if (acc?.owner_user_id) return acc.owner_user_id;

  const { data: prof } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle();
  return prof?.user_id || null;
}

export async function findAccountStage(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  stageId: string
): Promise<{ id: string; pipeline_id: string; name: string } | null> {
  const { data, error } = await db
    .from('pipeline_stages')
    .select('id, pipeline_id, name, pipelines!inner(id, account_id)')
    .eq('id', stageId)
    .eq('pipelines.account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as any;
}

export async function applyContactTags(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  names: string[],
  actingUserId?: string | null
) {
  if (!Array.isArray(names) || names.length === 0) return;

  const { data: existingTags } = await db
    .from('tags')
    .select('id, name')
    .eq('account_id', accountId);

  const tagMap = new Map<string, string>();
  for (const t of (existingTags || [])) {
    if (t?.name) tagMap.set(t.name.toLowerCase(), t.id);
  }

  for (const rawName of names) {
    const cleanName = String(rawName || '').trim();
    if (!cleanName) continue;

    let tagId = tagMap.get(cleanName.toLowerCase());
    if (!tagId) {
      const { data: newTag, error: tagErr } = await db
        .from('tags')
        .insert({
          account_id: accountId,
          user_id: actingUserId || null,
          name: cleanName,
          color: '#6366f1',
        })
        .select('id, name')
        .single();
      if (!tagErr && newTag?.id) {
        tagId = newTag.id;
        tagMap.set(cleanName.toLowerCase(), tagId as string);
      }
    }

    if (tagId) {
      await db
        .from('contact_tags')
        .upsert(
          { contact_id: contactId, tag_id: tagId },
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
        );
    }
  }
}

export async function applyContactCustomFields(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  values: Record<string, any>
): Promise<string[]> {
  if (!values || typeof values !== 'object') return [];

  const { data: accountFields } = await db
    .from('custom_fields')
    .select('id, field_name')
    .eq('account_id', accountId);

  const fieldMap = new Map<string, string>();
  for (const f of (accountFields || [])) {
    if (f?.field_name) fieldMap.set(f.field_name.toLowerCase(), f.id);
  }

  const skipped: string[] = [];

  for (const [key, val] of Object.entries(values)) {
    const fieldId = fieldMap.get(key.toLowerCase());
    if (!fieldId) {
      skipped.push(key);
      continue;
    }

    const strVal = val === null || val === undefined ? null : String(val);
    await db
      .from('contact_custom_values')
      .upsert(
        { contact_id: contactId, custom_field_id: fieldId, value: strVal },
        { onConflict: 'contact_id,custom_field_id' }
      );
  }

  return skipped;
}

/**
 * Executes an MCP tool call for an authenticated account.
 */
export async function executeMCPTool(
  accountId: string,
  userId: string | undefined,
  call: MCPToolCallParams
): Promise<MCPToolResult> {
  const db = supabaseAdmin();
  const args = call.arguments || {};

  try {
    switch (call.name) {
      // -------------------------------------------------------------
      // CONTACTS
      // -------------------------------------------------------------
      case 'search_contacts': {
        const rawQuery = String(args.query || '').trim();
        const query = sanitizeSearchTerm(rawQuery);
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);

        if (!query) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Search query is required' }) }],
            isError: true,
          };
        }

        const { data, error } = await db
          .from('contacts')
          .select(`id, name, phone, email, company, created_at, updated_at, ${CONTACT_RELATIONS}`)
          .eq('account_id', accountId)
          .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%,company.ilike.%${query}%`)
          .limit(limit);

        if (error) throw error;
        const contacts = (data || []).map(flattenContact);

        return {
          content: [{ type: 'text', text: JSON.stringify({ contacts, count: contacts.length }, null, 2) }],
        };
      }

      case 'get_contact': {
        const contactId = String(args.contact_id || '').trim();
        if (!contactId) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'contact_id is required' }) }],
            isError: true,
          };
        }

        const { data: rawContact, error } = await db
          .from('contacts')
          .select(`*, ${CONTACT_RELATIONS}`)
          .eq('id', contactId)
          .eq('account_id', accountId)
          .maybeSingle();

        if (error || !rawContact) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Contact not found' }) }],
            isError: true,
          };
        }

        const contact = flattenContact(rawContact);

        // Fetch open deals and recent conversation
        const { data: deals } = await db
          .from('deals')
          .select('id, title, value, currency, stage_id, pipeline_id, status, updated_at, created_at, stage:pipeline_stages(name)')
          .eq('contact_id', contactId)
          .eq('account_id', accountId);

        const { data: conv } = await db
          .from('conversations')
          .select('id, channel, status, unread_count, last_message_text, last_message_at, assigned_agent_id, last_customer_message_at, sla_breached_at')
          .eq('contact_id', contactId)
          .eq('account_id', accountId)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ contact, linked_deals: deals || [], recent_conversation: conv || null }, null, 2),
            },
          ],
        };
      }

      case 'create_or_update_contact': {
        const rawPhone = String(args.phone || '').trim();
        if (!rawPhone) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'phone is required' }) }],
            isError: true,
          };
        }

        const actingUserId = await resolveActingUserId(db, accountId, userId);
        const existing = await findExistingContact(db, accountId, rawPhone);

        let contactId: string;
        let status: 'created' | 'updated';

        if (existing) {
          status = 'updated';
          contactId = existing.id;
          const updatePayload: Record<string, any> = {
            updated_at: new Date().toISOString(),
          };
          if (args.name !== undefined) updatePayload.name = args.name;
          if (args.email !== undefined) updatePayload.email = args.email;
          if (args.company !== undefined) updatePayload.company = args.company;

          const { error } = await db
            .from('contacts')
            .update(updatePayload)
            .eq('id', contactId)
            .eq('account_id', accountId);

          if (error) throw error;
        } else {
          status = 'created';
          const cPhone = canonicalPhone(rawPhone);
          const { data: newContact, error } = await db
            .from('contacts')
            .insert({
              account_id: accountId,
              user_id: actingUserId,
              phone: cPhone,
              name: args.name || cPhone,
              email: args.email || null,
              company: args.company || null,
            })
            .select('id')
            .single();

          if (error) throw error;
          contactId = newContact.id;
        }

        // Apply tags
        if (Array.isArray(args.tags)) {
          await applyContactTags(db, accountId, contactId, args.tags, actingUserId);
        }

        // Apply custom fields
        let skipped_custom_fields: string[] = [];
        if (args.custom_fields && typeof args.custom_fields === 'object') {
          skipped_custom_fields = await applyContactCustomFields(db, accountId, contactId, args.custom_fields);
        }

        // Reload flattened contact
        const { data: finalRow } = await db
          .from('contacts')
          .select(`*, ${CONTACT_RELATIONS}`)
          .eq('id', contactId)
          .eq('account_id', accountId)
          .single();

        const contact = flattenContact(finalRow);

        const resultPayload: Record<string, any> = { status, contact };
        if (skipped_custom_fields.length > 0) {
          resultPayload.skipped_custom_fields = skipped_custom_fields;
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(resultPayload, null, 2) }],
        };
      }

      // -------------------------------------------------------------
      // CONVERSATIONS & MESSAGING
      // -------------------------------------------------------------
      case 'list_conversations': {
        const rawStatus = args.status !== undefined && args.status !== null ? String(args.status) : 'all';
        const dbStatus = rawStatus !== 'all' ? toDbConversationStatus(rawStatus) : null;
        const channel = args.channel && args.channel !== 'all' ? String(args.channel) : null;
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
        const offset = Math.max(Number(args.offset) || 0, 0);

        let query = db
          .from('conversations')
          .select('id, contact_id, channel, status, unread_count, last_message_text, last_message_at, assigned_agent_id, last_customer_message_at, sla_breached_at, contacts(id, name, phone, email)')
          .eq('account_id', accountId);

        if (dbStatus) query = query.eq('status', dbStatus);
        if (channel) query = query.eq('channel', channel);

        const { data, error } = await query
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .range(offset, offset + limit - 1);

        if (error) throw error;

        const count = data?.length || 0;
        const next_offset = count === limit ? offset + limit : null;

        return {
          content: [{ type: 'text', text: JSON.stringify({ conversations: data || [], count, next_offset }, null, 2) }],
        };
      }

      case 'get_conversation_messages': {
        const conversationId = String(args.conversation_id || '').trim();
        const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);

        if (!conversationId) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'conversation_id is required' }) }],
            isError: true,
          };
        }

        const { data: conv, error: convErr } = await db
          .from('conversations')
          .select('id, contact_id, channel')
          .eq('id', conversationId)
          .eq('account_id', accountId)
          .maybeSingle();

        if (convErr || !conv) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Conversation not found' }) }],
            isError: true,
          };
        }

        const { data: messages, error } = await db
          .from('messages')
          .select(MESSAGE_COLUMNS)
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        const formattedMessages = (messages || []).map((m: any) => ({
          ...m,
          media_type: m.content_type,
          whatsapp_message_id: m.message_id,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { conversation_id: conversationId, messages: formattedMessages.reverse(), count: formattedMessages.length },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'send_chat_message': {
        const conversationId = String(args.conversation_id || '').trim();
        const text = String(args.text || '').trim();

        if (!conversationId || !text) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'conversation_id and text are required' }) }],
            isError: true,
          };
        }

        const { data: conv, error: convErr } = await db
          .from('conversations')
          .select('id, contact_id, channel')
          .eq('id', conversationId)
          .eq('account_id', accountId)
          .maybeSingle();

        if (convErr || !conv) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Conversation not found' }) }],
            isError: true,
          };
        }

        const actingUserId = await resolveActingUserId(db, accountId, userId);

        if (conv.channel === 'whatsapp') {
          const result = await engineSendText({
            accountId,
            userId: actingUserId || 'agent',
            conversationId,
            contactId: conv.contact_id,
            text,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'WhatsApp message dispatched', result }, null, 2) }],
          };
        } else {
          // Channel message insertion for Instagram / Facebook or fallback
          const { data: msg, error: msgErr } = await db
            .from('messages')
            .insert({
              conversation_id: conversationId,
              sender_type: 'agent',
              sender_id: actingUserId,
              content_type: 'text',
              content_text: text,
            })
            .select('*')
            .single();

          if (msgErr) throw msgErr;

          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Message logged to thread', msg }, null, 2) }],
          };
        }
      }

      case 'send_whatsapp_template': {
        const phone = String(args.phone || '').trim();
        const templateName = String(args.template_name || '').trim();
        const language = String(args.language || 'en_US').trim();
        const bodyParameters = Array.isArray(args.body_parameters) ? args.body_parameters : [];

        if (!phone || !templateName) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'phone and template_name are required' }) }],
            isError: true,
          };
        }

        const actingUserId = await resolveActingUserId(db, accountId, userId);
        let contact = await findExistingContact(db, accountId, phone);

        if (!contact) {
          const cPhone = canonicalPhone(phone);
          const { data: newContact, error: createErr } = await db
            .from('contacts')
            .insert({
              account_id: accountId,
              user_id: actingUserId,
              phone: cPhone,
              name: cPhone,
            })
            .select('id, phone, name')
            .single();
          if (createErr) throw createErr;
          contact = newContact as any;
        }

        // Find or create conversation
        let { data: conv } = await db
          .from('conversations')
          .select('id')
          .eq('account_id', accountId)
          .eq('contact_id', contact!.id)
          .eq('channel', 'whatsapp')
          .maybeSingle();

        if (!conv) {
          const { data: newConv, error: convErr } = await db
            .from('conversations')
            .insert({
              account_id: accountId,
              user_id: actingUserId,
              contact_id: contact!.id,
              channel: 'whatsapp',
              status: 'open',
            })
            .select('id')
            .single();
          if (convErr) throw convErr;
          conv = newConv;
        }

        const result = await engineSendTemplate({
          accountId,
          userId: actingUserId || 'agent',
          conversationId: conv.id,
          contactId: contact!.id,
          templateName,
          language,
          params: bodyParameters,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'Template dispatched', result }, null, 2) }],
        };
      }

      case 'add_internal_note': {
        const conversationId = String(args.conversation_id || '').trim();
        const noteText = String(args.note_text || '').trim();

        if (!conversationId || !noteText) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'conversation_id and note_text are required' }) }],
            isError: true,
          };
        }

        // Verify conversation
        const { data: conv, error: convErr } = await db
          .from('conversations')
          .select('id')
          .eq('id', conversationId)
          .eq('account_id', accountId)
          .maybeSingle();

        if (convErr || !conv) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Conversation not found' }) }],
            isError: true,
          };
        }

        const actingUserId = await resolveActingUserId(db, accountId, userId);

        const { data: note, error } = await db
          .from('messages')
          .insert({
            conversation_id: conversationId,
            sender_type: 'agent',
            sender_id: actingUserId,
            content_type: 'text',
            content_text: noteText,
            is_internal: true,
          })
          .select('*')
          .single();

        if (error) throw error;

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, note }, null, 2) }],
        };
      }

      // -------------------------------------------------------------
      // DEALS & PIPELINES
      // -------------------------------------------------------------
      case 'list_deals': {
        const pipelineId = args.pipeline_id ? String(args.pipeline_id) : null;
        const stageId = args.stage_id ? String(args.stage_id) : null;
        const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);

        let query = db
          .from('deals')
          .select('id, title, value, currency, stage_id, pipeline_id, contact_id, status, notes, expected_close_date, updated_at, created_at, stage:pipeline_stages(name), contacts(id, name, phone)')
          .eq('account_id', accountId);

        if (pipelineId) query = query.eq('pipeline_id', pipelineId);
        if (stageId) query = query.eq('stage_id', stageId);

        const { data, error } = await query
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return {
          content: [{ type: 'text', text: JSON.stringify({ deals: data || [], count: data?.length || 0 }, null, 2) }],
        };
      }

      case 'create_deal': {
        const contactId = String(args.contact_id || '').trim();
        const title = String(args.title || '').trim();
        const stageId = String(args.stage_id || '').trim();
        const value = Number(args.value) || 0;

        if (!contactId || !title || !stageId) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'contact_id, title, and stage_id are required' }) }],
            isError: true,
          };
        }

        const stage = await findAccountStage(db, accountId, stageId);
        if (!stage) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Stage not found in this account' }) }],
            isError: true,
          };
        }

        const { data: contact } = await db
          .from('contacts')
          .select('id')
          .eq('id', contactId)
          .eq('account_id', accountId)
          .maybeSingle();

        if (!contact) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Contact not found' }) }],
            isError: true,
          };
        }

        const actingUserId = await resolveActingUserId(db, accountId, userId);

        let currency = args.currency ? String(args.currency).trim() : null;
        if (!currency) {
          const { data: acc } = await db
            .from('accounts')
            .select('default_currency')
            .eq('id', accountId)
            .maybeSingle();
          currency = acc?.default_currency || 'INR';
        }

        const { data: deal, error } = await db
          .from('deals')
          .insert({
            account_id: accountId,
            user_id: actingUserId,
            contact_id: contactId,
            pipeline_id: stage.pipeline_id,
            stage_id: stageId,
            title,
            value,
            currency,
            status: 'open',
          })
          .select('*')
          .single();

        if (error) throw error;

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, deal }, null, 2) }],
        };
      }

      case 'update_deal_stage': {
        const dealId = String(args.deal_id || '').trim();
        const stageId = String(args.stage_id || '').trim();

        if (!dealId || !stageId) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'deal_id and stage_id are required' }) }],
            isError: true,
          };
        }

        const { data: deal, error: dealErr } = await db
          .from('deals')
          .select('id, pipeline_id')
          .eq('id', dealId)
          .eq('account_id', accountId)
          .maybeSingle();

        if (dealErr || !deal) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Deal not found in this account' }) }],
            isError: true,
          };
        }

        const stage = await findAccountStage(db, accountId, stageId);
        if (!stage || stage.pipeline_id !== deal.pipeline_id) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Target stage must belong to the deal’s pipeline' }) }],
            isError: true,
          };
        }

        const { data: updatedDeal, error } = await db
          .from('deals')
          .update({ stage_id: stageId, updated_at: new Date().toISOString() })
          .eq('id', dealId)
          .eq('account_id', accountId)
          .select('*')
          .single();

        if (error) throw error;

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, deal: updatedDeal }, null, 2) }],
        };
      }

      // -------------------------------------------------------------
      // KNOWLEDGE BASE (RAG)
      // -------------------------------------------------------------
      case 'search_knowledge_base': {
        const query = String(args.query || '').trim();
        const kbId = args.kb_id ? String(args.kb_id).trim() : null;
        const limit = Math.min(Math.max(Number(args.limit) || 4, 1), 10);

        if (!query) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'query is required' }) }],
            isError: true,
          };
        }

        const cleanWords = query
          .replace(/[^\w\s]/g, ' ')
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0);

        const searchExpression = cleanWords.join(' or ');

        let kbQuery = db
          .from('knowledge_base_embeddings')
          .select('id, content, doc_id, knowledge_base_documents!inner(kb_id, filename, knowledge_bases!inner(account_id))')
          .eq('knowledge_base_documents.knowledge_bases.account_id', accountId);

        if (kbId) {
          kbQuery = kbQuery.eq('knowledge_base_documents.kb_id', kbId);
        }

        if (searchExpression) {
          kbQuery = kbQuery.textSearch('content', searchExpression, { type: 'websearch', config: 'english' });
        }

        const { data: chunks, error } = await kbQuery.limit(limit);

        if (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ results: [], count: 0 }, null, 2) }],
          };
        }

        const results = (chunks || []).map((c: any) => ({
          id: c.id,
          content: c.content,
          doc_id: c.doc_id,
          kb_id: c.knowledge_base_documents?.kb_id || null,
          filename: c.knowledge_base_documents?.filename || null,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ results, count: results.length }, null, 2),
            },
          ],
        };
      }

      // -------------------------------------------------------------
      // ACTION ITEMS (TASKS)
      // -------------------------------------------------------------
      case 'manage_action_items': {
        const action = String(args.action || 'list').toLowerCase();

        if (action === 'create') {
          const title = String(args.title || '').trim();
          if (!title) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'title is required to create an action item' }) }],
              isError: true,
            };
          }

          const actingUserId = await resolveActingUserId(db, accountId, userId);

          const { data, error } = await db
            .from('action_items')
            .insert({
              account_id: accountId,
              agent_id: actingUserId,
              assignee_id: actingUserId,
              title,
              target_date: args.target_date || new Date().toISOString().split('T')[0],
              contact_id: args.contact_id || null,
              status: 'todo',
              source: 'mcp',
            })
            .select('*')
            .single();

          if (error) throw error;
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, action_item: data }, null, 2) }],
          };
        }

        if (action === 'complete') {
          const itemId = String(args.item_id || '').trim();
          if (!itemId) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ error: 'item_id is required to complete an action item' }) }],
              isError: true,
            };
          }

          const { data, error } = await db
            .from('action_items')
            .update({ status: 'completed' })
            .eq('id', itemId)
            .eq('account_id', accountId)
            .select('*')
            .single();

          if (error) throw error;
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: true, action_item: data }, null, 2) }],
          };
        }

        // Default: list action items
        const { data, error } = await db
          .from('action_items')
          .select('id, title, status, target_date, contact_id, created_at')
          .eq('account_id', accountId)
          .order('target_date', { ascending: true })
          .limit(30);

        if (error) throw error;
        return {
          content: [{ type: 'text', text: JSON.stringify({ action_items: data || [] }, null, 2) }],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: `Tool not found: ${call.name}` }) }],
          isError: true,
        };
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: err?.message || String(err) }) }],
      isError: true,
    };
  }
}
