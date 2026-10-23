import { supabaseAdmin } from '@/lib/flows/admin-client';
import { engineSendText, engineSendTemplate } from '@/lib/automations/meta-send';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import type { MCPToolCallParams, MCPToolResult } from './types';

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
        const query = String(args.query || '').trim();
        const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);

        if (!query) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Search query is required' }) }],
            isError: true,
          };
        }

        const { data, error } = await db
          .from('contacts')
          .select('id, name, phone, email, company, tags, custom_fields, created_at, last_active_at')
          .eq('account_id', accountId)
          .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%,company.ilike.%${query}%`)
          .limit(limit);

        if (error) throw error;
        return {
          content: [{ type: 'text', text: JSON.stringify({ contacts: data || [], count: data?.length || 0 }, null, 2) }],
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

        const { data: contact, error } = await db
          .from('contacts')
          .select('*')
          .eq('id', contactId)
          .eq('account_id', accountId)
          .maybeSingle();

        if (error || !contact) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Contact not found' }) }],
            isError: true,
          };
        }

        // Fetch open deals and recent conversation
        const { data: deals } = await db
          .from('deals')
          .select('id, title, value, currency, stage_id, created_at')
          .eq('contact_id', contactId)
          .eq('account_id', accountId);

        const { data: conv } = await db
          .from('conversations')
          .select('id, channel, status, unread_count, last_message_text, last_message_at')
          .eq('contact_id', contactId)
          .eq('account_id', accountId)
          .order('last_message_at', { ascending: false })
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
        const phone = String(args.phone || '').trim();
        if (!phone) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'phone is required' }) }],
            isError: true,
          };
        }

        const sanitized = sanitizePhoneForMeta(phone);

        // Check if contact already exists
        const { data: existing } = await db
          .from('contacts')
          .select('id, name, phone, email, tags, custom_fields')
          .eq('account_id', accountId)
          .eq('phone', sanitized)
          .maybeSingle();

        const updatePayload: Record<string, any> = {};
        if (args.name) updatePayload.name = args.name;
        if (args.email) updatePayload.email = args.email;
        if (args.company) updatePayload.company = args.company;
        if (Array.isArray(args.tags)) updatePayload.tags = args.tags;
        if (args.custom_fields && typeof args.custom_fields === 'object') {
          updatePayload.custom_fields = {
            ...(existing?.custom_fields || {}),
            ...args.custom_fields,
          };
        }

        if (existing) {
          const { data, error } = await db
            .from('contacts')
            .update(updatePayload)
            .eq('id', existing.id)
            .select('*')
            .single();

          if (error) throw error;
          return {
            content: [{ type: 'text', text: JSON.stringify({ status: 'updated', contact: data }, null, 2) }],
          };
        } else {
          const { data, error } = await db
            .from('contacts')
            .insert({
              account_id: accountId,
              phone: sanitized,
              name: args.name || sanitized,
              email: args.email || null,
              company: args.company || null,
              tags: Array.isArray(args.tags) ? args.tags : [],
              custom_fields: args.custom_fields || {},
            })
            .select('*')
            .single();

          if (error) throw error;
          return {
            content: [{ type: 'text', text: JSON.stringify({ status: 'created', contact: data }, null, 2) }],
          };
        }
      }

      // -------------------------------------------------------------
      // CONVERSATIONS & MESSAGING
      // -------------------------------------------------------------
      case 'list_conversations': {
        const status = args.status && args.status !== 'all' ? String(args.status) : null;
        const channel = args.channel && args.channel !== 'all' ? String(args.channel) : null;
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);

        let query = db
          .from('conversations')
          .select('id, contact_id, channel, status, unread_count, last_message_text, last_message_at, contacts(id, name, phone, email)')
          .eq('account_id', accountId);

        if (status) query = query.eq('status', status);
        if (channel) query = query.eq('channel', channel);

        const { data, error } = await query
          .order('last_message_at', { ascending: false })
          .limit(limit);

        if (error) throw error;
        return {
          content: [{ type: 'text', text: JSON.stringify({ conversations: data || [], count: data?.length || 0 }, null, 2) }],
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

        // Verify conversation ownership
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
          .select('id, sender_type, content_text, media_url, media_type, created_at, whatsapp_message_id')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        // Reverse to chronological order
        const chronological = (messages || []).reverse();

        return {
          content: [{ type: 'text', text: JSON.stringify({ conversation: conv, messages: chronological }, null, 2) }],
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

        if (conv.channel === 'whatsapp') {
          const result = await engineSendText({
            accountId,
            userId: userId || 'agent',
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
              account_id: accountId,
              conversation_id: conversationId,
              sender_type: 'agent',
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

        const sanitized = sanitizePhoneForMeta(phone);

        // Find or create contact
        let { data: contact } = await db
          .from('contacts')
          .select('id')
          .eq('account_id', accountId)
          .eq('phone', sanitized)
          .maybeSingle();

        if (!contact) {
          const { data: newContact, error: createErr } = await db
            .from('contacts')
            .insert({ account_id: accountId, phone: sanitized, name: sanitized })
            .select('id')
            .single();
          if (createErr) throw createErr;
          contact = newContact;
        }

        // Find or create conversation
        let { data: conv } = await db
          .from('conversations')
          .select('id')
          .eq('account_id', accountId)
          .eq('contact_id', contact.id)
          .eq('channel', 'whatsapp')
          .maybeSingle();

        if (!conv) {
          const { data: newConv, error: convErr } = await db
            .from('conversations')
            .insert({ account_id: accountId, contact_id: contact.id, channel: 'whatsapp', status: 'open' })
            .select('id')
            .single();
          if (convErr) throw convErr;
          conv = newConv;
        }

        const result = await engineSendTemplate({
          accountId,
          userId: userId || 'agent',
          conversationId: conv.id,
          contactId: contact.id,
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

        const { data: note, error } = await db
          .from('messages')
          .insert({
            account_id: accountId,
            conversation_id: conversationId,
            sender_type: 'note',
            content_text: noteText,
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
          .select('id, title, value, currency, stage_id, pipeline_id, contact_id, probability, created_at, contacts(id, name, phone)')
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
        const currency = String(args.currency || 'USD').trim();

        if (!contactId || !title || !stageId) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'contact_id, title, and stage_id are required' }) }],
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

        const { data: stage } = await db
          .from('pipeline_stages')
          .select('id, pipeline_id')
          .eq('id', stageId)
          .maybeSingle();

        const { data: deal, error } = await db
          .from('deals')
          .insert({
            account_id: accountId,
            contact_id: contactId,
            pipeline_id: stage?.pipeline_id || null,
            stage_id: stageId,
            title,
            value,
            currency,
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

        const { data: deal, error } = await db
          .from('deals')
          .update({ stage_id: stageId, updated_at: new Date().toISOString() })
          .eq('id', dealId)
          .eq('account_id', accountId)
          .select('*')
          .single();

        if (error) throw error;

        return {
          content: [{ type: 'text', text: JSON.stringify({ success: true, deal }, null, 2) }],
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

        // Full-text keyword search fallback across KB document embeddings
        const searchWords = query
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2)
          .slice(0, 5)
          .join(' | ');

        let kbQuery = db
          .from('knowledge_base_embeddings')
          .select('id, content, doc_id');

        if (searchWords) {
          kbQuery = kbQuery.textSearch('content', searchWords, { type: 'websearch', config: 'english' });
        }

        const { data: chunks, error } = await kbQuery.limit(limit);

        if (error) throw error;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ results: chunks || [], count: chunks?.length || 0 }, null, 2),
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

          const { data, error } = await db
            .from('action_items')
            .insert({
              account_id: accountId,
              agent_id: userId || (await db.from('profiles').select('user_id').eq('account_id', accountId).limit(1).single()).data?.user_id,
              title,
              target_date: args.target_date || new Date().toISOString().split('T')[0],
              contact_id: args.contact_id || null,
              status: 'pending',
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
          content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool name: ${call.name}` }) }],
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
