import type { McpTool } from '../registry';
import { McpUserError } from '../format';
import { findExistingContact, canonicalPhone } from '@/lib/contacts/dedupe';
import { engineSendTemplate } from '@/lib/automations/meta-send';

export const templateTools: McpTool[] = [
  {
    name: 'send_whatsapp_template',
    title: 'Send WhatsApp template',
    description: 'Send a pre-approved Meta WhatsApp HSM template message to a contact by phone number. Can initiate outreach outside the 24h customer messaging window.',
    scope: 'messages:send',
    minRole: 'agent',
    kind: 'send',
    inputSchema: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Recipient phone number in E.164 format.',
        },
        template_name: {
          type: 'string',
          description: 'Name of the approved WhatsApp template.',
        },
        language: {
          type: 'string',
          description: 'Template language code (e.g. en_US, en, hi).',
          default: 'en_US',
        },
        body_parameters: {
          type: 'array',
          items: { type: 'string' },
          description: 'Positional string parameters matching {{1}}, {{2}} in template body.',
        },
      },
      required: ['phone', 'template_name'],
    },
    async handler(ctx, args) {
      const phone = String(args.phone || '').trim();
      const templateName = String(args.template_name || '').trim();
      const language = String(args.language || 'en_US').trim();
      const bodyParameters = Array.isArray(args.body_parameters) ? args.body_parameters : [];

      if (!phone || !templateName) {
        throw new McpUserError('phone and template_name are required');
      }

      const actingUserId = ctx.userId;
      let contact = await findExistingContact(ctx.db, ctx.accountId, phone);

      if (!contact) {
        const cPhone = canonicalPhone(phone);
        const { data: newContact, error: createErr } = await ctx.db
          .from('contacts')
          .insert({
            account_id: ctx.accountId,
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
      let { data: conv } = await ctx.db
        .from('conversations')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contact!.id)
        .eq('channel', 'whatsapp')
        .maybeSingle();

      if (!conv) {
        const { data: newConv, error: convErr } = await ctx.db
          .from('conversations')
          .insert({
            account_id: ctx.accountId,
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
        accountId: ctx.accountId,
        userId: actingUserId || 'agent',
        conversationId: conv.id,
        contactId: contact!.id,
        templateName,
        language,
        params: bodyParameters,
      });

      ctx.audit.sends = 1;
      ctx.audit.targetId = conv.id;

      return { success: true, message: 'Template dispatched', result };
    },
  },
];

