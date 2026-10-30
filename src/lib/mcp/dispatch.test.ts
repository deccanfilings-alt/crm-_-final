import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callTool, shortenArgs, assertSendAllowed } from './dispatch';
import { getTool } from './registry';
import { McpUserError } from './format';
import type { McpContext } from './context';

vi.mock('@/lib/automations/meta-send', () => ({
  engineSendText: vi.fn().mockResolvedValue({ messageId: 'wamid.test1234' }),
  engineSendTemplate: vi.fn().mockResolvedValue({ messageId: 'wamid.test5678' }),
}));

import { engineSendText } from '@/lib/automations/meta-send';

describe('MCP Dispatch: Rate Limiting & Audit Logging (Task 2)', () => {
  let dbMock: any;
  let insertedLogs: any[] = [];

  beforeEach(() => {
    insertedLogs = [];
    vi.clearAllMocks();

    dbMock = {
      from: vi.fn().mockImplementation((table: string) => {
        const query: any = {};
        query.select = vi.fn().mockReturnValue(query);
        query.eq = vi.fn().mockReturnValue(query);
        query.gt = vi.fn().mockReturnValue(query);
        query.gte = vi.fn().mockReturnValue(query);
        query.is = vi.fn().mockReturnValue(query);
        query.order = vi.fn().mockReturnValue(query);
        query.limit = vi.fn().mockReturnValue(query);
        query.range = vi.fn().mockReturnValue(query);

        query.insert = vi.fn().mockImplementation((payload: any) => {
          insertedLogs.push(payload);
          return Promise.resolve({ data: payload, error: null });
        });

        query.maybeSingle = vi.fn().mockImplementation(() => {
          if (table === 'conversations') {
            return Promise.resolve({
              data: {
                id: 'conv-1',
                contact_id: 'contact-1',
                channel: 'whatsapp',
                last_customer_message_at: null,
              },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        });

        query.then = (onFulfilled: any) => {
          if (table === 'mcp_tool_calls') {
            return Promise.resolve({ data: [], error: null }).then(onFulfilled);
          }
          return Promise.resolve({ data: [], error: null }).then(onFulfilled);
        };

        return query;
      }),
    };
  });

  it('shortens string arguments over 300 characters and drops null/undefined values', () => {
    const longStr = 'a'.repeat(350);
    const args = {
      title: 'Short',
      description: longStr,
      optional_field: null,
      missing_field: undefined,
      nested: {
        comment: longStr,
        empty: null,
      },
    };

    const shortened = shortenArgs(args);
    expect(shortened.title).toBe('Short');
    expect(shortened.description).toHaveLength(303); // 300 + '...'
    expect(shortened.description.endsWith('...')).toBe(true);
    expect(shortened.optional_field).toBeUndefined();
    expect(shortened.missing_field).toBeUndefined();
    expect(shortened.nested.comment).toHaveLength(303);
    expect(shortened.nested.empty).toBeUndefined();
  });

  it('refuses the 21st send in an hour from one key, and sends nothing', async () => {
    // Mock 20 sends returned in the last hour
    dbMock.from.mockImplementation((table: string) => {
      const query: any = {};
      query.select = vi.fn().mockReturnValue(query);
      query.eq = vi.fn().mockReturnValue(query);
      query.gt = vi.fn().mockReturnValue(query);
      query.gte = vi.fn().mockReturnValue(query);
      query.is = vi.fn().mockReturnValue(query);
      query.insert = vi.fn().mockImplementation((payload: any) => {
        insertedLogs.push(payload);
        return Promise.resolve({ data: payload, error: null });
      });

      query.then = (onFulfilled: any) => {
        if (table === 'mcp_tool_calls') {
          // Return 20 sends
          return Promise.resolve({
            data: Array(20).fill({ sends: 1 }),
            error: null,
          }).then(onFulfilled);
        }
        return Promise.resolve({ data: [], error: null }).then(onFulfilled);
      };

      return query;
    });

    const ctx: McpContext = {
      db: dbMock,
      accountId: 'acc-1',
      userId: 'user-1',
      userName: 'Alice',
      role: 'agent',
      scopes: ['messages:send'],
      keyId: 'key-test',
      keyName: 'Test Key',
      legacyKey: false,
      audit: {},
    };

    const res = await callTool(ctx, 'send_chat_message', {
      conversation_id: 'conv-1',
      text: 'Message 21',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Send limit reached for this key (20 per hour)');
    expect(engineSendText).not.toHaveBeenCalled();

    // Verify it was logged with ok: false
    const failedLog = insertedLogs.find((l) => l.tool === 'send_chat_message');
    expect(failedLog).toBeDefined();
    expect(failedLog.ok).toBe(false);
    expect(failedLog.error).toContain('Send limit reached');
  });

  it('refuses a 4th message to the same chat within 10 minutes with no customer reply', async () => {
    let callCount = 0;
    dbMock.from.mockImplementation((table: string) => {
      const query: any = {};
      query.select = vi.fn().mockReturnValue(query);
      query.eq = vi.fn().mockReturnValue(query);
      query.gt = vi.fn().mockReturnValue(query);
      query.gte = vi.fn().mockReturnValue(query);
      query.is = vi.fn().mockReturnValue(query);
      query.insert = vi.fn().mockImplementation((payload: any) => {
        insertedLogs.push(payload);
        return Promise.resolve({ data: payload, error: null });
      });

      query.maybeSingle = vi.fn().mockImplementation(() => {
        if (table === 'conversations') {
          return Promise.resolve({
            data: { id: 'conv-1', contact_id: 'c-1', channel: 'whatsapp', last_customer_message_at: null },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      });

      query.then = (onFulfilled: any) => {
        if (table === 'mcp_tool_calls') {
          callCount++;
          // First query: hourly check (0 sends)
          // Second query: daily check (0 sends)
          // Third query: per-chat check (3 sends)
          if (callCount === 3) {
            return Promise.resolve({
              data: [{ sends: 1 }, { sends: 1 }, { sends: 1 }],
              error: null,
            }).then(onFulfilled);
          }
          return Promise.resolve({ data: [], error: null }).then(onFulfilled);
        }
        return Promise.resolve({ data: [], error: null }).then(onFulfilled);
      };

      return query;
    });

    const ctx: McpContext = {
      db: dbMock,
      accountId: 'acc-1',
      userId: 'user-1',
      userName: 'Alice',
      role: 'agent',
      scopes: ['messages:send'],
      keyId: 'key-test',
      keyName: 'Test Key',
      legacyKey: false,
      audit: {},
    };

    const res = await callTool(ctx, 'send_chat_message', {
      conversation_id: 'conv-1',
      text: 'Message 4',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Too many automated messages sent to this conversation in 10 minutes');
    expect(engineSendText).not.toHaveBeenCalled();
  });

  it('logs failed tool call with ok = false', async () => {
    const ctx: McpContext = {
      db: dbMock,
      accountId: 'acc-1',
      userId: 'user-1',
      userName: 'Alice',
      role: 'agent',
      scopes: ['contacts:read'],
      keyId: 'key-test',
      keyName: 'Test Key',
      legacyKey: false,
      audit: {},
    };

    // Calling search_contacts without query parameter
    const res = await callTool(ctx, 'search_contacts', {});

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('Search query is required');

    const logEntry = insertedLogs.find((l) => l.tool === 'search_contacts');
    expect(logEntry).toBeDefined();
    expect(logEntry.ok).toBe(false);
    expect(logEntry.error).toContain('Search query is required');
  });

  it('still returns tool result even if log insert fails', async () => {
    dbMock.from.mockImplementation((table: string) => {
      const query: any = {};
      query.select = vi.fn().mockReturnValue(query);
      query.eq = vi.fn().mockReturnValue(query);
      query.or = vi.fn().mockReturnValue(query);
      query.limit = vi.fn().mockReturnValue(query);

      query.insert = vi.fn().mockRejectedValue(new Error('Database write connection timeout'));

      query.then = (onFulfilled: any) => {
        if (table === 'contacts') {
          return Promise.resolve({
            data: [{ id: 'c-1', name: 'John Doe', phone: '9988776655' }],
            error: null,
          }).then(onFulfilled);
        }
        return Promise.resolve({ data: [], error: null }).then(onFulfilled);
      };

      return query;
    });

    const ctx: McpContext = {
      db: dbMock,
      accountId: 'acc-1',
      userId: 'user-1',
      userName: 'Alice',
      role: 'agent',
      scopes: ['contacts:read'],
      keyId: 'key-test',
      keyName: 'Test Key',
      legacyKey: false,
      audit: {},
    };

    const res = await callTool(ctx, 'search_contacts', { query: 'John' });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0].text);
    expect(data.contacts).toHaveLength(1);
    expect(data.contacts[0].name).toBe('John Doe');
  });
});

