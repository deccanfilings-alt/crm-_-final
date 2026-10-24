import type { MCPToolDefinition } from './types';

export const WACRM_MCP_TOOLS: MCPToolDefinition[] = [
  {
    name: 'search_contacts',
    description: 'Search CRM contacts by name, phone number, email address, or company name.',
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
  },
  {
    name: 'get_contact',
    description: 'Retrieve full details for a specific contact by their contact ID, including tags, custom fields, and linked metadata.',
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
  },
  {
    name: 'create_or_update_contact',
    description: 'Create a new contact or update existing contact attributes (name, email, company, tags, custom fields) by phone number. Tags are additive. Custom fields must already exist under Settings → Fields & Tags.',
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
  },
  {
    name: 'list_conversations',
    description: 'List recent customer conversations and inbox threads with filtering by status and channel.',
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
  },
  {
    name: 'get_conversation_messages',
    description: 'Fetch chronologically sorted message history for a specific conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'UUID of the conversation thread.',
        },
        limit: {
          type: 'number',
          description: 'Number of recent messages to return (default 25, max 100).',
          default: 25,
        },
      },
      required: ['conversation_id'],
    },
  },
  {
    name: 'send_chat_message',
    description: 'Send a live text reply to a customer in an active conversation (WhatsApp, Instagram, or Facebook). Note: For WhatsApp, this requires an active 24h customer window.',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'UUID of the conversation to send the message in.',
        },
        text: {
          type: 'string',
          description: 'Text content to send to the customer.',
        },
      },
      required: ['conversation_id', 'text'],
    },
  },
  {
    name: 'send_whatsapp_template',
    description: 'Send a pre-approved WhatsApp template message to a contact phone number. Useful for initiating conversations or re-opening expired 24h sessions.',
    inputSchema: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Recipient phone number (E.164 format).',
        },
        template_name: {
          type: 'string',
          description: 'Name of the Meta pre-approved WhatsApp template.',
        },
        language: {
          type: 'string',
          description: 'Template language code (e.g. en_US, en). Default is en_US.',
          default: 'en_US',
        },
        body_parameters: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ordered variable values for template placeholder parameters {{1}}, {{2}}, etc.',
        },
      },
      required: ['phone', 'template_name'],
    },
  },
  {
    name: 'add_internal_note',
    description: 'Add a private internal note to a conversation. Internal notes are visible only to team members and never sent to the customer.',
    inputSchema: {
      type: 'object',
      properties: {
        conversation_id: {
          type: 'string',
          description: 'UUID of the conversation.',
        },
        note_text: {
          type: 'string',
          description: 'The note text content.',
        },
      },
      required: ['conversation_id', 'note_text'],
    },
  },
  {
    name: 'list_deals',
    description: 'List sales pipeline deals with deal values, stages, and associated contacts.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: {
          type: 'string',
          description: 'Optional UUID of the pipeline.',
        },
        stage_id: {
          type: 'string',
          description: 'Optional UUID of the pipeline stage.',
        },
        limit: {
          type: 'number',
          description: 'Max deals to return (default 25).',
          default: 25,
        },
      },
    },
  },
  {
    name: 'create_deal',
    description: 'Create a new deal in a sales pipeline linked to a contact.',
    inputSchema: {
      type: 'object',
      properties: {
        contact_id: {
          type: 'string',
          description: 'UUID of the contact.',
        },
        title: {
          type: 'string',
          description: 'Title of the deal (e.g. "Acme Corp Annual Contract").',
        },
        value: {
          type: 'number',
          description: 'Monetary value of the deal.',
        },
        stage_id: {
          type: 'string',
          description: 'UUID of the stage to place the deal in.',
        },
        currency: {
          type: 'string',
          description: 'Currency code (e.g. USD, EUR, INR). Defaults to workspace default.',
        },
      },
      required: ['contact_id', 'title', 'value', 'stage_id'],
    },
  },
  {
    name: 'update_deal_stage',
    description: 'Move an existing deal to a different pipeline stage.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: {
          type: 'string',
          description: 'UUID of the deal.',
        },
        stage_id: {
          type: 'string',
          description: 'UUID of the target stage.',
        },
      },
      required: ['deal_id', 'stage_id'],
    },
  },
  {
    name: 'search_knowledge_base',
    description: "Keyword search across this workspace's Knowledge Base chunks (matches any of the words).",
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The natural language question or keyword query.',
        },
        kb_id: {
          type: 'string',
          description: 'Optional UUID of a specific Knowledge Base to search within.',
        },
        limit: {
          type: 'number',
          description: 'Max number of document chunks to return (default 4).',
          default: 4,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'manage_action_items',
    description: 'List, create, or mark as completed action items (tasks) for accountability and SLA tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'complete'],
          description: 'Action to perform.',
        },
        title: {
          type: 'string',
          description: 'Title of the task (required when action=create).',
        },
        contact_id: {
          type: 'string',
          description: 'Optional UUID of the linked contact.',
        },
        target_date: {
          type: 'string',
          description: 'Target due date in YYYY-MM-DD format (for action=create).',
        },
        item_id: {
          type: 'string',
          description: 'UUID of the action item (required when action=complete).',
        },
      },
      required: ['action'],
    },
  },
];
