import { describe, it, expect } from 'vitest';
import { hashApiKey, hasScope } from '@/lib/auth/agent-auth';
import { WACRM_MCP_TOOLS } from './tools';

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
