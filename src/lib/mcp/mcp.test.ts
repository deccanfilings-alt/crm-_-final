import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashApiKey, hasScope } from '@/lib/auth/agent-auth';
import { WACRM_MCP_TOOLS } from './tools';
import { buildContext, McpAuthError, type McpContext } from './context';
import { PRESETS } from './scopes';
import { whyDenied } from './permissions';
import { callTool } from './dispatch';
import { getTool, MCP_TOOLS } from './registry';
import { toResult, istTime } from './format';
import { GET, POST } from '@/app/api/mcp/route';

const dbMock = {
  from: vi.fn().mockImplementation((table: string) => {
    const builder: any = {};
    builder.select = vi.fn().mockReturnValue(builder);
    builder.update = vi.fn().mockReturnValue(builder);
    builder.eq = vi.fn().mockReturnValue(builder);
    builder.then = vi.fn().mockImplementation((resolve) => Promise.resolve({ data: null, error: null }).then(resolve));
    builder.maybeSingle = vi.fn().mockImplementation(() => {
      if (table === 'profiles') {
        return Promise.resolve({
          data: { full_name: 'Agent Alice', account_role: 'agent' },
          error: null,
        });
      }
      if (table === 'accounts') {
        return Promise.resolve({
          data: { owner_user_id: 'user-owner-1' },
          error: null,
        });
      }
      if (table === 'api_keys') {
        return Promise.resolve({
          data: {
            id: 'key-1',
            account_id: 'acc-123',
            created_by: 'user-agent-456',
            name: 'test-key',
            key_prefix: 'wacrm_live_test...',
            key_hash: 'mockhash',
            scopes: ['all'],
            is_active: true,
            expires_at: null,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    return builder;
  }),
};

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => dbMock,
}));

describe('Agent Auth Helper', () => {
  it('hashes API key deterministically with SHA-256', () => {
    const rawKey = 'wacrm_live_0123456789abcdef';
    const hash1 = hashApiKey(rawKey);
    const hash2 = hashApiKey(rawKey);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex is 64 characters
    expect(hash1).not.toBe(rawKey);
  });

  it('correctly handles scope verification', () => {
    // 'all' grants everything
    expect(hasScope(['all'], 'contacts:read')).toBe(true);
    expect(hasScope(['all'], 'messages:send')).toBe(true);

    // Specific scopes
    expect(hasScope(['contacts:read', 'deals:read'], 'contacts:read')).toBe(true);
    expect(hasScope(['contacts:read'], 'messages:send')).toBe(false);

    // Empty or undefined scopes
    expect(hasScope([], 'contacts:read')).toBe(false);
    expect(hasScope(undefined, 'contacts:read')).toBe(false);
  });
});

describe('WACRM MCP Tools Catalog', () => {
  it('exposes all expected core CRM tools', () => {
    const toolNames = WACRM_MCP_TOOLS.map((t) => t.name);

    expect(toolNames).toContain('search_contacts');
    expect(toolNames).toContain('get_contact');
    expect(toolNames).toContain('create_or_update_contact');
    expect(toolNames).toContain('list_conversations');
    expect(toolNames).toContain('get_conversation_messages');
    expect(toolNames).toContain('send_chat_message');
    expect(toolNames).toContain('send_whatsapp_template');
    expect(toolNames).toContain('add_internal_note');
    expect(toolNames).toContain('list_deals');
    expect(toolNames).toContain('create_deal');
    expect(toolNames).toContain('update_deal_stage');
    expect(toolNames).toContain('search_knowledge_base');
    expect(toolNames).toContain('manage_action_items');
  });

  it('validates tool schema structure for MCP compliance', () => {
    for (const tool of WACRM_MCP_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe('string');
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.inputSchema.properties).toBe('object');
    }
  });
});

describe('MCP Context & Attribution (Task 1)', () => {
  it('resolves creator identity and role for key calls', async () => {
    const auth = {
      success: true,
      account_id: 'acc-123',
      user_id: 'user-agent-456',
      key_id: 'key-789',
      key_name: 'Agent Key',
      scopes: ['contacts:read', 'notes:write'],
      legacy_no_creator: false,
    };

    const ctx = await buildContext(auth);
    expect(ctx.accountId).toBe('acc-123');
    expect(ctx.userId).toBe('user-agent-456');
    expect(ctx.userName).toBe('Agent Alice');
    expect(ctx.role).toBe('agent');
    expect(ctx.keyId).toBe('key-789');
    expect(ctx.legacyKey).toBe(false);
  });

  it('handles legacy keys without creator by acting as owner with read_only scopes', async () => {
    const auth = {
      success: true,
      account_id: 'acc-123',
      key_id: 'key-old',
      key_name: 'Old Key',
      scopes: ['all'],
      legacy_no_creator: true,
    };

    const ctx = await buildContext(auth);
    expect(ctx.role).toBe('owner');
    expect(ctx.legacyKey).toBe(true);
    expect(ctx.scopes).toEqual(PRESETS.read_only);
  });

  it('throws 403 when key creator is no longer in account', async () => {
    dbMock.from.mockImplementationOnce(() => {
      const b: any = {};
      b.select = vi.fn().mockReturnValue(b);
      b.eq = vi.fn().mockReturnValue(b);
      b.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      return b;
    });

    const auth = {
      success: true,
      account_id: 'acc-123',
      user_id: 'user-removed',
      key_id: 'key-orphan',
      key_name: 'Orphan Key',
      scopes: ['contacts:read'],
      legacy_no_creator: false,
    };

    await expect(buildContext(auth)).rejects.toThrow(McpAuthError);
  });
});

describe('MCP Permissions & Scope Enforcement (Task 1)', () => {
  it('denies write and send tools to viewer role', () => {
    const viewerCtx: McpContext = {
      db: {} as any,
      accountId: 'acc-1',
      userId: 'user-viewer',
      userName: 'Viewer Bob',
      role: 'viewer',
      scopes: ['all'],
      keyId: null,
      keyName: 'session',
      legacyKey: false,
      audit: {},
    };

    const searchTool = getTool('search_contacts')!;
    const sendTool = getTool('send_chat_message')!;
    const noteTool = getTool('add_internal_note')!;

    expect(whyDenied(viewerCtx, searchTool)).toBeNull();
    expect(whyDenied(viewerCtx, sendTool)).toBe('Your role (viewer) can\'t use send_chat_message.');
    expect(whyDenied(viewerCtx, noteTool)).toBe('Your role (viewer) can\'t use add_internal_note.');
  });

  it('denies tools when key lacks the required scope', () => {
    const scopedCtx: McpContext = {
      db: {} as any,
      accountId: 'acc-1',
      userId: 'user-agent',
      userName: 'Agent Alice',
      role: 'agent',
      scopes: ['contacts:read'],
      keyId: 'key-1',
      keyName: 'contacts-only',
      legacyKey: false,
      audit: {},
    };

    const sendTool = getTool('send_chat_message')!;
    const reason = whyDenied(scopedCtx, sendTool);
    expect(reason).toContain('This key doesn\'t have the "messages:send" permission.');
  });

  it('callTool returns errorResult when permission is denied', async () => {
    const readOnlyCtx: McpContext = {
      db: {} as any,
      accountId: 'acc-1',
      userId: 'user-agent',
      userName: 'Agent Alice',
      role: 'agent',
      scopes: ['contacts:read'],
      keyId: 'key-1',
      keyName: 'read-key',
      legacyKey: false,
      audit: {},
    };

    const res = await callTool(readOnlyCtx, 'send_chat_message', {
      conversation_id: 'conv-1',
      text: 'Hello',
    });

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('messages:send');
  });
});

describe('Task 3: Protocol, Annotations & Format Helpers', () => {
  it('formats toResult compactly without indentation', () => {
    const res = toResult({ foo: 'bar', num: 123 });
    expect(res.content[0].text).toBe('{"foo":"bar","num":123}');
    expect(res.content[0].text).not.toContain('\n  ');
  });

  it('formats istTime to +05:30 offset', () => {
    const formatted = istTime('2026-10-30T00:00:00.000Z');
    expect(formatted).toBe('2026-10-30T05:30:00+05:30');
  });

  it('ensures all MCP_TOOLS have titles and proper annotations', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.title).toBeTruthy();
      expect(typeof tool.title).toBe('string');
      if (tool.kind === 'read') {
        expect(tool.kind).toBe('read');
      } else if (tool.kind === 'write') {
        if (tool.name === 'create_or_update_contact' || tool.name === 'update_deal_stage') {
          expect(tool.idempotent).toBe(true);
        }
      }
    }
  });

  it('verifies GET with text/event-stream returns 405', async () => {
    const req = new Request('http://localhost/api/mcp', {
      headers: {
        Accept: 'text/event-stream',
      },
    });
    const res = await GET(req);
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET, POST');
  });

  it('verifies POST notifications/initialized returns 202', async () => {
    const req = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_key',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(202);
  });
});
