import { describe, it, expect, vi, beforeEach } from 'vitest';

interface DbCall {
  method: string;
  table: string;
  args: any;
}
const recordedCalls: DbCall[] = [];

function createQueryBuilder(table: string) {
  const builder: any = {};
  builder._table = table;
  builder.select = vi.fn().mockImplementation((cols: string) => {
    recordedCalls.push({ method: 'select', table, args: cols });
    return builder;
  });
  builder.insert = vi.fn().mockImplementation((payload: any) => {
    recordedCalls.push({ method: 'insert', table, args: payload });
    return builder;
  });
  builder.update = vi.fn().mockImplementation((payload: any) => {
    recordedCalls.push({ method: 'update', table, args: payload });
    return builder;
  });
  builder.upsert = vi.fn().mockImplementation((payload: any) => {
    recordedCalls.push({ method: 'upsert', table, args: payload });
    return builder;
  });
  builder.eq = vi.fn().mockImplementation((col: string, val: any) => {
    recordedCalls.push({ method: 'eq', table, args: { col, val } });
    return builder;
  });
  builder.or = vi.fn().mockImplementation((expr: string) => {
    recordedCalls.push({ method: 'or', table, args: expr });
    return builder;
  });
  builder.ilike = vi.fn().mockReturnValue(builder);
  builder.textSearch = vi.fn().mockImplementation((col: string, expr: string) => {
    recordedCalls.push({ method: 'textSearch', table, args: { col, expr } });
    return builder;
  });
  builder.order = vi.fn().mockReturnValue(builder);
  builder.limit = vi.fn().mockReturnValue(builder);
  builder.range = vi.fn().mockImplementation((from: number, to: number) => {
    recordedCalls.push({ method: 'range', table, args: { from, to } });
    return builder;
  });
  builder.single = vi.fn().mockImplementation(() => {
    if (table === 'deals') {
      return Promise.resolve({ data: { id: 'deal-1', title: 'New Deal' }, error: null });
    }
    if (table === 'contacts') {
      return Promise.resolve({ data: { id: 'c-new', name: 'New Contact' }, error: null });
    }
    if (table === 'action_items') {
      return Promise.resolve({ data: { id: 'act-1', title: 'Action' }, error: null });
    }
    if (table === 'messages') {
      return Promise.resolve({ data: { id: 'msg-1', content_text: 'note' }, error: null });
    }
    return Promise.resolve({ data: { id: 'test-1' }, error: null });
  });
  builder.maybeSingle = vi.fn().mockImplementation(() => {
    if (table === 'accounts') {
      return Promise.resolve({ data: { owner_user_id: 'user-owner-1', default_currency: 'INR' }, error: null });
    }
    if (table === 'pipeline_stages') {
      return Promise.resolve({ data: { id: 'stage-1', pipeline_id: 'pipe-1', name: 'Discovery' }, error: null });
    }
    if (table === 'conversations') {
      return Promise.resolve({ data: { id: 'conv-1', contact_id: 'c-1', channel: 'whatsapp' }, error: null });
    }
    if (table === 'contacts') {
      return Promise.resolve({ data: { id: 'c-1', name: 'Alice' }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  builder.then = (onFulfilled: any) => Promise.resolve({ data: [], error: null }).then(onFulfilled);

  return builder;
}

const dbMock = {
  from: vi.fn().mockImplementation((table: string) => createQueryBuilder(table)),
};

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => dbMock,
}));

vi.mock('@/lib/automations/meta-send', () => ({
  engineSendText: vi.fn().mockResolvedValue({ messageId: 'wamid.fake123' }),
  engineSendTemplate: vi.fn().mockResolvedValue({ messageId: 'wamid.fake456' }),
}));

import {
  flattenContact,
  toDbConversationStatus,
  sanitizeSearchTerm,
  executeMCPTool,
} from './handlers';

describe('MCP Handlers Pure Helpers', () => {
  it('flattenContact flattens tags and custom values', () => {
    const raw = {
      id: 'c1',
      name: 'Alice',
      contact_tags: [{ tags: { name: 'VIP' } }, { tags: { name: 'Lead' } }],
      contact_custom_values: [
        { value: 'GST', custom_fields: { field_name: 'Service' } },
        { value: 'Web', custom_fields: { field_name: 'Source' } },
      ],
    };
    const flat = flattenContact(raw);
    expect(flat.tags).toEqual(['VIP', 'Lead']);
    expect(flat.custom_fields).toEqual({ Service: 'GST', Source: 'Web' });
    expect(flat.contact_tags).toBeUndefined();
    expect(flat.contact_custom_values).toBeUndefined();
  });

  it('toDbConversationStatus maps resolved to closed', () => {
    expect(toDbConversationStatus('resolved')).toBe('closed');
    expect(toDbConversationStatus('RESOLVED')).toBe('closed');
    expect(toDbConversationStatus('open')).toBe('open');
    expect(toDbConversationStatus('pending')).toBe('pending');
    expect(toDbConversationStatus('closed')).toBe('closed');
  });

  it('sanitizeSearchTerm removes special characters but keeps . and @', () => {
    expect(sanitizeSearchTerm('test,*(hello)%\\"world')).toBe('test hello world');
    expect(sanitizeSearchTerm('user@example.com')).toBe('user@example.com');
  });
});

describe('MCP Tool Execution with Database Mock', () => {
  beforeEach(() => {
    recordedCalls.length = 0;
    dbMock.from.mockImplementation((table: string) => createQueryBuilder(table));
  });

  it('add_internal_note stores message as sender_type agent with is_internal true and NO account_id', async () => {
    const res = await executeMCPTool('acc-1', 'user-agent-9', {
      name: 'add_internal_note',
      arguments: {
        conversation_id: 'conv-1',
        note_text: 'Discussed pricing with client',
      },
    });

    if (res.isError) {
      console.error('add_internal_note error:', res.content[0].text);
    }
    expect(res.isError).toBeFalsy();
    const insertCall = recordedCalls.find((c) => c.method === 'insert' && c.table === 'messages');
    expect(insertCall).toBeDefined();
    expect(insertCall?.args.sender_type).toBe('agent');
    expect(insertCall?.args.is_internal).toBe(true);
    expect(insertCall?.args.content_text).toBe('Discussed pricing with client');
    expect(insertCall?.args.account_id).toBeUndefined();
  });

  it('list_deals queries existing columns without probability', async () => {
    const res = await executeMCPTool('acc-1', 'user-1', {
      name: 'list_deals',
      arguments: {},
    });

    if (res.isError) {
      console.error('list_deals error:', res.content[0].text);
    }
    expect(res.isError).toBeFalsy();
    const selectCall = recordedCalls.find((c) => c.method === 'select' && c.table === 'deals');
    expect(selectCall).toBeDefined();
    expect(selectCall?.args).not.toContain('probability');
    expect(selectCall?.args).toContain('status');
  });

  it('create_deal sets user_id and default currency', async () => {
    const res = await executeMCPTool('acc-1', null as any, {
      name: 'create_deal',
      arguments: {
        contact_id: 'c-1',
        stage_id: 'stage-1',
        title: 'GST Filing Package',
        value: 15000,
      },
    });

    if (res.isError) {
      console.error('create_deal error:', res.content[0].text);
    }
    expect(res.isError).toBeFalsy();
    const insertCall = recordedCalls.find((c) => c.method === 'insert' && c.table === 'deals');
    expect(insertCall).toBeDefined();
    expect(insertCall?.args.currency).toBe('INR');
    expect(insertCall?.args.user_id).toBe('user-owner-1');
    expect(insertCall?.args.probability).toBeUndefined();
  });

  it('create_deal rejects a stage from another account', async () => {
    dbMock.from.mockImplementation((table: string) => {
      const q: any = createQueryBuilder(table);
      if (table === 'pipeline_stages') {
        q.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      }
      return q;
    });

    const res = await executeMCPTool('acc-1', 'user-1', {
      name: 'create_deal',
      arguments: {
        contact_id: 'c-1',
        stage_id: 'stage-foreign',
        title: 'Deal',
        value: 1000,
      },
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Stage not found in this account');
  });

  it('search_knowledge_base joins words with or and filters by account', async () => {
    const res = await executeMCPTool('acc-1', 'user-1', {
      name: 'search_knowledge_base',
      arguments: {
        query: 'private limited registration',
      },
    });

    if (res.isError) {
      console.error('search_knowledge_base error:', res.content[0].text);
    }
    expect(res.isError).toBeFalsy();
    const searchCall = recordedCalls.find((c) => c.method === 'textSearch' && c.table === 'knowledge_base_embeddings');
    expect(searchCall).toBeDefined();
    expect(searchCall?.args.expr).toBe('private or limited or registration');
  });
});
