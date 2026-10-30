import type { McpTool } from '../registry';
import { McpUserError } from '../format';
import { toDbConversationStatus, MESSAGE_COLUMNS } from '../handlers';
import { engineSendText } from '@/lib/automations/meta-send';

export const conversationTools: McpTool[] = [
  {
    name: 'list_conversations',
    title: 'List conversations',
    description: 'List recent customer conversations and inbox threads with filtering by status and channel.',
    scope: 'conversations:read',
    minRole: 'viewer',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'pending', 'closed', 'resolved', 'all'],
          description: 'Filter by conversation status: open, pending, closed (resolved is an alias for closed), or all (default: all).',
          default: 'all',
        },
        channel: {
          type: 'string',
          enum: ['whatsapp', 'instagram', 'facebook', 'all'],
          description: 'Filter by communication channel.',
          default: 'all',
        },
        limit: {
          type: 'number',
          description: 'Number of conversations to retrieve (default 20, max 50).',
          default: 20,
        },
        offset: {
          type: 'number',
          description: 'Number of conversations to skip for pagination (default: 0).',
          default: 0,
        },
      },
    },
    async handler(ctx, args) {
      const rawStatus = args.status !== undefined && args.status !== null ? String(args.status) : 'all';
      const dbStatus = rawStatus !== 'all' ? toDbConversationStatus(rawStatus) : null;
      const channel = args.channel && args.channel !== 'all' ? String(args.channel) : null;
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
      const offset = Math.max(Number(args.offset) || 0, 0);

      let query = ctx.db
        .from('conversations')
        .select('id, contact_id, channel, status, unread_count, last_message_text, last_message_at, assigned_agent_id, last_customer_message_at, sla_breached_at, contacts(id, name, phone, email)')
        .eq('account_id', ctx.accountId);

      if (dbStatus) query = query.eq('status', dbStatus);
      if (channel) query = query.eq('channel', channel);

      const { data, error } = await query
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      const count = data?.length || 0;
      const next_offset = count === limit ? offset + limit : null;

      return { conversations: data || [], count, next_offset };
    },
  },
  {
    name: 'get_conversation_messages',
    title: 'Get conversation messages',
    description: 'Fetch message history for a specific conversation by ID in chronological order.',
    scope: 'conversations:read',
    minRole: 'viewer',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'The UUID of the conversation.',
        },
        limit: {
          type: 'number',
          description: 'Max number of messages to return (default 25, max 100).',
          default: 25,
        },
      },
      required: ['conversation_id'],
    },
    async handler(ctx, args) {
      const conversationId = String(args.conversation_id || '').trim();
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);

      if (!conversationId) {
        throw new McpUserError('conversation_id is required');
      }

      const { data: conv, error: convErr } = await ctx.db
        .from('conversations')
        .select('id, contact_id, channel')
        .eq('id', conversationId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (convErr || !conv) {
        throw new McpUserError('Conversation not found');
      }

      const { data: messages, error } = await ctx.db
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
        conversation_id: conversationId,
        messages: formattedMessages.reverse(),
        count: formattedMessages.length,
      };
    },
  },
  {
    name: 'send_chat_message',
    title: 'Send chat message',
    description: 'Send a real-time text message to an existing conversation across WhatsApp, Instagram, or Facebook channels. On WhatsApp, requires an active 24h customer messaging window.',
    scope: 'messages:send',
    minRole: 'agent',
    kind: 'send',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'The UUID of the conversation to send into.',
        },
        text: {
          type: 'string',
          description: 'Message body content.',
        },
      },
      required: ['conversation_id', 'text'],
    },
    async handler(ctx, args) {
      const conversationId = String(args.conversation_id || '').trim();
      const text = String(args.text || '').trim();

      if (!conversationId || !text) {
        throw new McpUserError('conversation_id and text are required');
      }

      const { data: conv, error: convErr } = await ctx.db
        .from('conversations')
        .select('id, contact_id, channel')
        .eq('id', conversationId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (convErr || !conv) {
        throw new McpUserError('Conversation not found');
      }

      const actingUserId = ctx.userId;

      if (conv.channel === 'whatsapp') {
        const result = await engineSendText({
          accountId: ctx.accountId,
          userId: actingUserId || 'agent',
          conversationId,
          contactId: conv.contact_id,
          text,
        });

        ctx.audit.sends = 1;
        ctx.audit.targetId = conversationId;

        return { success: true, message: 'WhatsApp message dispatched', result };
      } else {
        // Channel message insertion for Instagram / Facebook or fallback
        const { data: msg, error: msgErr } = await ctx.db
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

        ctx.audit.sends = 1;
        ctx.audit.targetId = conversationId;

        return { success: true, message: 'Message logged to thread', msg };
      }
    },
  },
  {
    name: 'add_internal_note',
    title: 'Add internal note',
    description: 'Add an internal agent note to a conversation thread. Internal notes are invisible to customers and only viewed by staff.',
    scope: 'notes:write',
    minRole: 'agent',
    kind: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'The UUID of the conversation thread.',
        },
        note_text: {
          type: 'string',
          description: 'The internal comment or staff note text.',
        },
      },
      required: ['conversation_id', 'note_text'],
    },
    async handler(ctx, args) {
      const conversationId = String(args.conversation_id || '').trim();
      const noteText = String(args.note_text || '').trim();

      if (!conversationId || !noteText) {
        throw new McpUserError('conversation_id and note_text are required');
      }

      // Verify conversation
      const { data: conv, error: convErr } = await ctx.db
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (convErr || !conv) {
        throw new McpUserError('Conversation not found');
      }

      const actingUserId = ctx.userId;

      const { data: note, error } = await ctx.db
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

      return { success: true, note };
    },
  },
];
