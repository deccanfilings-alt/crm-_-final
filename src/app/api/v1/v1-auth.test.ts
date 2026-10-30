import { describe, it, expect, vi } from 'vitest';
import { GET as searchContacts } from './contacts/search/route';
import { GET as listConversations } from './conversations/route';
import { POST as sendMessage } from './messages/send/route';

vi.mock('@/lib/auth/agent-auth', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    authenticateAgentRequest: vi.fn(),
  };
});

vi.mock('@/lib/mcp/handlers', () => ({
  executeMCPTool: vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
  }),
}));

import { authenticateAgentRequest } from '@/lib/auth/agent-auth';

describe('/api/v1/* Scopes Enforcement', () => {
  it('rejects contacts search when contacts:read is missing', async () => {
    vi.mocked(authenticateAgentRequest).mockResolvedValueOnce({
      success: true,
      account_id: 'acc-1',
      scopes: ['conversations:read'],
    });

    const req = new Request('https://crm.test/api/v1/contacts/search?query=test');
    const res = await searchContacts(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('contacts:read');
  });

  it('rejects conversations list when conversations:read is missing', async () => {
    vi.mocked(authenticateAgentRequest).mockResolvedValueOnce({
      success: true,
      account_id: 'acc-1',
      scopes: ['contacts:read'],
    });

    const req = new Request('https://crm.test/api/v1/conversations');
    const res = await listConversations(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('conversations:read');
  });

  it('rejects messages send when messages:send is missing', async () => {
    vi.mocked(authenticateAgentRequest).mockResolvedValueOnce({
      success: true,
      account_id: 'acc-1',
      scopes: ['contacts:read', 'conversations:read'],
    });

    const req = new Request('https://crm.test/api/v1/messages/send', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: 'c-1', text: 'Hi' }),
    });
    const res = await sendMessage(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('messages:send');
  });

  it('allows access when scope is present or all is granted', async () => {
    vi.mocked(authenticateAgentRequest).mockResolvedValueOnce({
      success: true,
      account_id: 'acc-1',
      scopes: ['contacts:read'],
    });

    const req = new Request('https://crm.test/api/v1/contacts/search?query=test');
    const res = await searchContacts(req);
    expect(res.status).toBe(200);
  });
});

