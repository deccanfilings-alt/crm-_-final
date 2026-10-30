import type { McpTool } from '../registry';
import { McpUserError } from '../format';
import { todayIST } from '@/lib/dates';

export const taskTools: McpTool[] = [
  {
    name: 'manage_action_items',
    title: 'Manage action items',
    description: 'List, create, or complete internal team action items and operational tasks. (Legacy alias; will be replaced by dedicated task tools).',
    scope: 'tasks:write',
    minRole: 'agent',
    kind: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'complete'],
          description: 'The operation to perform: list (default), create, or complete.',
          default: 'list',
        },
        title: {
          type: 'string',
          description: 'Title of the action item (required for create).',
        },
        target_date: {
          type: 'string',
          description: 'Due date in YYYY-MM-DD format (defaults to today IST).',
        },
        contact_id: {
          type: 'string',
          description: 'Optional UUID of the linked contact.',
        },
        item_id: {
          type: 'string',
          description: 'The UUID of the action item to complete (required for complete).',
        },
      },
    },
    async handler(ctx, args) {
      const action = String(args.action || 'list').toLowerCase();

      if (action === 'create') {
        const title = String(args.title || '').trim();
        if (!title) {
          throw new McpUserError('title is required to create an action item');
        }

        const actingUserId = ctx.userId;

        const { data, error } = await ctx.db
          .from('action_items')
          .insert({
            account_id: ctx.accountId,
            agent_id: actingUserId,
            assignee_id: actingUserId,
            title,
            target_date: args.target_date || todayIST(),
            contact_id: args.contact_id || null,
            status: 'todo',
            source: 'mcp',
          })
          .select('*')
          .single();

        if (error) throw error;
        return { success: true, action_item: data };
      }

      if (action === 'complete') {
        const itemId = String(args.item_id || '').trim();
        if (!itemId) {
          throw new McpUserError('item_id is required to complete an action item');
        }

        const { data, error } = await ctx.db
          .from('action_items')
          .update({ status: 'completed' })
          .eq('id', itemId)
          .eq('account_id', ctx.accountId)
          .select('*')
          .single();

        if (error) throw error;
        return { success: true, action_item: data };
      }

      // Default: list action items
      const { data, error } = await ctx.db
        .from('action_items')
        .select('id, title, status, target_date, contact_id, created_at')
        .eq('account_id', ctx.accountId)
        .order('target_date', { ascending: true })
        .limit(30);

      if (error) throw error;
      return { action_items: data || [] };
    },
  },
];

