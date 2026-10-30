import type { McpTool } from '../registry';
import { McpUserError } from '../format';
import { findAccountStage } from '../handlers';

export const dealTools: McpTool[] = [
  {
    name: 'list_deals',
    title: 'List deals',
    description: 'List CRM deals with optional filtering by pipeline or pipeline stage.',
    scope: 'deals:read',
    minRole: 'viewer',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: {
          type: 'string',
          description: 'Filter deals by pipeline UUID.',
        },
        stage_id: {
          type: 'string',
          description: 'Filter deals by stage UUID.',
        },
        limit: {
          type: 'number',
          description: 'Max number of deals to return (default 25, max 100).',
          default: 25,
        },
      },
    },
    async handler(ctx, args) {
      const pipelineId = args.pipeline_id ? String(args.pipeline_id) : null;
      const stageId = args.stage_id ? String(args.stage_id) : null;
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);

      let query = ctx.db
        .from('deals')
        .select('id, title, value, currency, stage_id, pipeline_id, contact_id, status, notes, expected_close_date, updated_at, created_at, stage:pipeline_stages(name), contacts(id, name, phone)')
        .eq('account_id', ctx.accountId);

      if (pipelineId) query = query.eq('pipeline_id', pipelineId);
      if (stageId) query = query.eq('stage_id', stageId);

      const { data, error } = await query
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { deals: data || [], count: data?.length || 0 };
    },
  },
  {
    name: 'create_deal',
    title: 'Create deal',
    description: 'Create a new deal associated with a contact in a specific pipeline stage.',
    scope: 'deals:write',
    minRole: 'agent',
    kind: 'write',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: {
          type: 'string',
          description: 'The UUID of the associated contact.',
        },
        title: {
          type: 'string',
          description: 'Title of the deal (e.g. GST Annual Filing Package).',
        },
        stage_id: {
          type: 'string',
          description: 'The stage UUID where the deal should be placed.',
        },
        value: {
          type: 'number',
          description: 'Monetary value of the deal.',
          default: 0,
        },
        currency: {
          type: 'string',
          description: '3-letter currency code (defaults to workspace default, e.g. INR).',
        },
      },
      required: ['contact_id', 'title', 'stage_id'],
    },
    async handler(ctx, args) {
      const contactId = String(args.contact_id || '').trim();
      const title = String(args.title || '').trim();
      const stageId = String(args.stage_id || '').trim();
      const value = Number(args.value) || 0;

      if (!contactId || !title || !stageId) {
        throw new McpUserError('contact_id, title, and stage_id are required');
      }

      const stage = await findAccountStage(ctx.db, ctx.accountId, stageId);
      if (!stage) {
        throw new McpUserError('Stage not found in this account');
      }

      const { data: contact } = await ctx.db
        .from('contacts')
        .select('id')
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (!contact) {
        throw new McpUserError('Contact not found');
      }

      const actingUserId = ctx.userId;

      let currency = args.currency ? String(args.currency).trim() : null;
      if (!currency) {
        const { data: acc } = await ctx.db
          .from('accounts')
          .select('default_currency')
          .eq('id', ctx.accountId)
          .maybeSingle();
        currency = acc?.default_currency || 'INR';
      }

      const { data: deal, error } = await ctx.db
        .from('deals')
        .insert({
          account_id: ctx.accountId,
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

      return { success: true, deal };
    },
  },
  {
    name: 'update_deal_stage',
    title: 'Update deal stage',
    description: 'Move an existing deal to a different pipeline stage within its pipeline.',
    scope: 'deals:write',
    minRole: 'agent',
    kind: 'write',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: {
          type: 'string',
          description: 'The UUID of the deal to move.',
        },
        stage_id: {
          type: 'string',
          description: 'The target stage UUID.',
        },
      },
      required: ['deal_id', 'stage_id'],
    },
    async handler(ctx, args) {
      const dealId = String(args.deal_id || '').trim();
      const stageId = String(args.stage_id || '').trim();

      if (!dealId || !stageId) {
        throw new McpUserError('deal_id and stage_id are required');
      }

      const { data: deal, error: dealErr } = await ctx.db
        .from('deals')
        .select('id, pipeline_id')
        .eq('id', dealId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (dealErr || !deal) {
        throw new McpUserError('Deal not found in this account');
      }

      const stage = await findAccountStage(ctx.db, ctx.accountId, stageId);
      if (!stage || stage.pipeline_id !== deal.pipeline_id) {
        throw new McpUserError('Target stage must belong to the deal’s pipeline');
      }

      const { data: updatedDeal, error } = await ctx.db
        .from('deals')
        .update({ stage_id: stageId, updated_at: new Date().toISOString() })
        .eq('id', dealId)
        .eq('account_id', ctx.accountId)
        .select('*')
        .single();

      if (error) throw error;

      return { success: true, deal: updatedDeal };
    },
  },
];

