import { describe, expect, it, vi, beforeEach } from 'vitest';
import { processBroadcast, getDailyUniqueRecipientCount } from './broadcast-engine';
import * as metaApiModule from './meta-api';
import * as encryptionModule from './encryption';

describe('processBroadcast Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(encryptionModule, 'decrypt').mockReturnValue('mock_access_token');
  });

  it('retries on a 429 rate limit error on first attempt and delivers message on second attempt', async () => {
    let sendAttempts = 0;
    vi.spyOn(metaApiModule, 'sendTemplateMessage').mockImplementation(async () => {
      sendAttempts++;
      if (sendAttempts === 1) {
        const err: any = new Error('Rate limit exceeded');
        err.status = 429;
        err.code = 130429;
        throw err;
      }
      return { messageId: 'wamid.test12345' };
    });

    const mockBroadcast = {
      id: 'bc-1',
      account_id: 'acc-1',
      template_name: 'hello_world',
      template_language: 'en_US',
      sent_count: 0,
      failed_count: 0,
    };

    const mockRecipients = [
      { id: 'rec-1', broadcast_id: 'bc-1', contact_id: 'c-1', status: 'pending', attempt_count: 0, contact: { id: 'c-1', phone: '9876543210' } },
    ];

    const updatedRows: Record<string, any>[] = [];

    const createChainableMock = (data: any, onUpdate?: (payload: any) => void) => {
      const obj: any = {
        select: () => obj,
        eq: () => obj,
        in: () => obj,
        not: () => obj,
        gte: () => obj,
        limit: () => obj,
        single: () => Promise.resolve({ data, error: null }),
        maybeSingle: () => Promise.resolve({ data, error: null }),
        update: (payload: any) => {
          if (onUpdate) onUpdate(payload);
          return obj;
        },
        then: (resolve: any) => resolve({ data, error: null }),
      };
      return obj;
    };

    const supabaseAdminMock = {
      from: (table: string) => {
        if (table === 'broadcasts') {
          return createChainableMock(mockBroadcast);
        }
        if (table === 'whatsapp_config') {
          return createChainableMock({ phone_number_id: '123', access_token: 'valid' });
        }
        if (table === 'message_templates') {
          return createChainableMock(null);
        }
        if (table === 'broadcast_recipients') {
          const obj = createChainableMock(mockRecipients, (payload) => updatedRows.push(payload));
          obj.gte = () => createChainableMock([]);
          return obj;
        }
        if (table === 'contacts') {
          return createChainableMock({ opted_out_marketing: false });
        }
        return createChainableMock(null);
      },
    };

    const result = await processBroadcast(supabaseAdminMock, 'bc-1');

    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(sendAttempts).toBe(2);
    expect(updatedRows.some((r) => r.status === 'sent' && r.whatsapp_message_id === 'wamid.test12345')).toBe(true);
  });

  it('halts broadcast on simulated 132015 abort error and leaves remaining rows queued', async () => {
    vi.spyOn(metaApiModule, 'sendTemplateMessage').mockImplementation(async () => {
      const err: any = new Error('Template is disabled by Meta');
      err.status = 400;
      err.code = 132015;
      throw err;
    });

    const mockBroadcast = {
      id: 'bc-2',
      account_id: 'acc-1',
      template_name: 'disabled_template',
      template_language: 'en_US',
    };

    const mockRecipients = [
      { id: 'rec-1', broadcast_id: 'bc-2', contact_id: 'c-1', status: 'pending', attempt_count: 0, contact: { id: 'c-1', phone: '9876543210' } },
      { id: 'rec-2', broadcast_id: 'bc-2', contact_id: 'c-2', status: 'pending', attempt_count: 0, contact: { id: 'c-2', phone: '9876543211' } },
    ];

    const broadcastUpdates: Record<string, any>[] = [];
    const recipientUpdates: Record<string, any>[] = [];

    const createChainableMock = (data: any, onUpdate?: (payload: any) => void) => {
      const obj: any = {
        select: () => obj,
        eq: () => obj,
        in: () => obj,
        not: () => obj,
        gte: () => obj,
        limit: () => obj,
        single: () => Promise.resolve({ data, error: null }),
        maybeSingle: () => Promise.resolve({ data, error: null }),
        update: (payload: any) => {
          if (onUpdate) onUpdate(payload);
          return obj;
        },
        then: (resolve: any) => resolve({ data, error: null }),
      };
      return obj;
    };

    const supabaseAdminMock = {
      from: (table: string) => {
        if (table === 'broadcasts') {
          return createChainableMock(mockBroadcast, (payload) => broadcastUpdates.push(payload));
        }
        if (table === 'whatsapp_config') {
          return createChainableMock({ phone_number_id: '123', access_token: 'valid' });
        }
        if (table === 'message_templates') {
          return createChainableMock(null);
        }
        if (table === 'broadcast_recipients') {
          const obj = createChainableMock(mockRecipients, (payload) => recipientUpdates.push(payload));
          obj.gte = () => createChainableMock([]);
          return obj;
        }
        if (table === 'contacts') {
          return createChainableMock({ opted_out_marketing: false });
        }
        return createChainableMock(null);
      },
    };

    const result = await processBroadcast(supabaseAdminMock, 'bc-2');

    expect(result.status).toBe('halted');
    expect(result.haltedCode).toBe(132015);
    expect(broadcastUpdates.some((b) => b.status === 'halted' && b.halted_code === 132015)).toBe(true);
    expect(recipientUpdates.some((r) => r.disposition === 'abort')).toBe(true);
  });
  it('builds unique recipient set with 10-digit sanitized key even for 12-digit stored numbers', async () => {
    const mockDb: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            gte: () => ({
              in: async () => ({
                data: [
                  { contact: { phone: '919573157786' }, sent_at: new Date().toISOString() },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    };

    const result = await getDailyUniqueRecipientCount(mockDb, 'acc-1');
    expect(result.count).toBe(1);
    expect(result.uniquePhones.has('9573157786')).toBe(true);
  });
});
