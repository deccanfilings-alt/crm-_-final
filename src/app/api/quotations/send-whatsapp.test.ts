import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './[id]/send-whatsapp/route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/quotations/settings', () => ({
  getQuotationSettings: vi.fn().mockResolvedValue({
    company_name: 'Deccan Filings',
  }),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn().mockResolvedValue({ messageId: 'wamid.123' }),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((val: string) => val),
}));

describe('Send WhatsApp Quotation Route', () => {
  const mockUser = { id: 'usr-123' };
  const mockProfile = { account_id: 'acc-456' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects if quote has no phone number', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProfile }),
          };
        }
        if (table === 'quotations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'q-1',
                client_name: 'John Doe',
                client_phone: null,
                contact: null,
              },
              error: null,
            }),
          };
        }
        return {};
      }),
    });

    const req = new Request('http://localhost/api/quotations/q-1/send-whatsapp', {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'q-1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('phone number is missing');
  });

  it('sends successfully and updates status to sent', async () => {
    const mockUpdate = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'q-1',
        status: 'sent',
        sent_at: '2026-10-25T00:00:00Z',
      },
      error: null,
    });

    const { createClient } = await import('@/lib/supabase/server');
    (createClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: mockProfile }),
          };
        }
        if (table === 'quotations') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'q-1',
                quote_number: 'DF-QT-1001',
                title: 'PVT LTD Registration',
                client_name: 'John Doe',
                client_phone: '919876543210',
                total_amount: 15000,
                public_token: 'tok-abc',
                conversation_id: 'conv-1',
              },
              error: null,
            }),
            update: mockUpdate,
          };
        }
        if (table === 'whatsapp_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { phone_number_id: 'pid-1', access_token: 'tok-1' },
            }),
          };
        }
        if (table === 'messages' || table === 'conversations') {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          update: mockUpdate,
          eq: mockEq,
          select: mockSelect,
          single: mockSingle,
        };
      }),
    });

    const req = new Request('http://localhost/api/quotations/q-1/send-whatsapp', {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'q-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.publicUrl).toContain('/quote/tok-abc');
  });
});
