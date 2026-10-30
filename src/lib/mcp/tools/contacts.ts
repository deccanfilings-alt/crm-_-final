import type { McpTool } from '../registry';
import { McpUserError } from '../format';
import {
  flattenContact,
  sanitizeSearchTerm,
  CONTACT_RELATIONS,
  applyContactTags,
  applyContactCustomFields,
} from '../handlers';
import { findExistingContact, canonicalPhone } from '@/lib/contacts/dedupe';

export const contactTools: McpTool[] = [
  {
    name: 'search_contacts',
    title: 'Search contacts',
    description: 'Search CRM contacts by name, phone number, email address, or company name.',
    scope: 'contacts:read',
    minRole: 'viewer',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search string matching name, phone, email, or company.',
        },
        limit: {
          type: 'number',
          description: 'Max number of results to return (default 10, max 50).',
          default: 10,
        },
      },
      required: ['query'],
    },
    async handler(ctx, args) {
      const rawQuery = String(args.query || '').trim();
      const query = sanitizeSearchTerm(rawQuery);
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);

      if (!query) {
        throw new McpUserError('Search query is required');
      }

      const { data, error } = await ctx.db
        .from('contacts')
        .select(`id, name, phone, email, company, created_at, updated_at, ${CONTACT_RELATIONS}`)
        .eq('account_id', ctx.accountId)
        .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%,company.ilike.%${query}%`)
        .limit(limit);

      if (error) throw error;
      const contacts = (data || []).map(flattenContact);

      return { contacts, count: contacts.length };
    },
  },
  {
    name: 'get_contact',
    title: 'Get contact details',
    description: 'Retrieve full details for a specific contact by their contact ID, including tags, custom fields, and linked metadata.',
    scope: 'contacts:read',
    minRole: 'viewer',
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: {
          type: 'string',
          description: 'The UUID of the contact in WACRM.',
        },
      },
      required: ['contact_id'],
    },
    async handler(ctx, args) {
      const contactId = String(args.contact_id || '').trim();
      if (!contactId) {
        throw new McpUserError('contact_id is required');
      }

      const { data: rawContact, error } = await ctx.db
        .from('contacts')
        .select(`*, ${CONTACT_RELATIONS}`)
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();

      if (error || !rawContact) {
        throw new McpUserError('Contact not found');
      }

      const contact = flattenContact(rawContact);

      // Fetch open deals and recent conversation
      const { data: deals } = await ctx.db
        .from('deals')
        .select('id, title, value, currency, stage_id, pipeline_id, status, updated_at, created_at, stage:pipeline_stages(name)')
        .eq('contact_id', contactId)
        .eq('account_id', ctx.accountId);

      const { data: conv } = await ctx.db
        .from('conversations')
        .select('id, channel, status, unread_count, last_message_text, last_message_at, assigned_agent_id, last_customer_message_at, sla_breached_at')
        .eq('contact_id', contactId)
        .eq('account_id', ctx.accountId)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      return { contact, linked_deals: deals || [], recent_conversation: conv || null };
    },
  },
  {
    name: 'create_or_update_contact',
    title: 'Create or update contact',
    description: 'Create a new contact or update existing contact attributes (name, email, company, tags, custom fields) by phone number. Tags are additive. Custom fields must already exist under Settings → Fields & Tags.',
    scope: 'contacts:write',
    minRole: 'agent',
    kind: 'write',
    idempotent: true,
    inputSchema: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Phone number in E.164 or national format (e.g. +1234567890).',
        },
        name: {
          type: 'string',
          description: 'Full name or company display name of the contact.',
        },
        email: {
          type: 'string',
          description: 'Email address of the contact.',
        },
        company: {
          type: 'string',
          description: 'Company name associated with this contact.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of tag names to associate with this contact (additive).',
        },
        custom_fields: {
          type: 'object',
          description: 'Key-value pairs of existing custom fields defined for your workspace.',
        },
      },
      required: ['phone'],
    },
    async handler(ctx, args) {
      const rawPhone = String(args.phone || '').trim();
      if (!rawPhone) {
        throw new McpUserError('phone is required');
      }

      const actingUserId = ctx.userId;
      const existing = await findExistingContact(ctx.db, ctx.accountId, rawPhone);

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

        const { error } = await ctx.db
          .from('contacts')
          .update(updatePayload)
          .eq('id', contactId)
          .eq('account_id', ctx.accountId);

        if (error) throw error;
      } else {
        status = 'created';
        const cPhone = canonicalPhone(rawPhone);
        const { data: newContact, error } = await ctx.db
          .from('contacts')
          .insert({
            account_id: ctx.accountId,
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
        await applyContactTags(ctx.db, ctx.accountId, contactId, args.tags, actingUserId);
      }

      // Apply custom fields
      let skipped_custom_fields: string[] = [];
      if (args.custom_fields && typeof args.custom_fields === 'object') {
        skipped_custom_fields = await applyContactCustomFields(ctx.db, ctx.accountId, contactId, args.custom_fields);
      }

      // Reload flattened contact
      const { data: finalRow } = await ctx.db
        .from('contacts')
        .select(`*, ${CONTACT_RELATIONS}`)
        .eq('id', contactId)
        .eq('account_id', ctx.accountId)
        .single();

      const contact = flattenContact(finalRow);

      const resultPayload: Record<string, any> = { status, contact };
      if (skipped_custom_fields.length > 0) {
        resultPayload.skipped_custom_fields = skipped_custom_fields;
      }

      return resultPayload;
    },
  },
];
