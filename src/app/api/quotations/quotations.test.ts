import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { PATCH as updateStatus } from './[id]/status/route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/quotations/settings', () => ({
  getQuotationSettings: vi.fn().mockResolvedValue({
    quote_prefix: 'DF-QT-',
    next_quote_number: 1001,
    default_currency: 'INR',
    default_tax_rate: 18.0,
    default_terms: 'Valid 15 days',
  }),
}));

describe('Quotations API Routes', () => {
  const mockUser = { id: 'usr-123' };
  const mockProfile = { account_id: 'acc-456', account_role: 'admin' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: new Error('Not logged in') }),
      },
    });

    const req = new Request('http://localhost/api/quotations');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('validates required fields on creation', async () => {
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
        return {};
      }),
    });

    const req = new Request('http://localhost/api/quotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('title is required');
  });

  it('updates status and validates status transitions', async () => {
    const mockUpdate = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockSelect = vi.fn().mockReturnThis();
    const mockSingle = vi.fn().mockResolvedValue({
      data: { id: 'q-1', status: 'accepted', accepted_at: '2026-10-25T00:00:00Z' },
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
        return {
          update: mockUpdate,
          eq: mockEq,
          select: mockSelect,
          single: mockSingle,
        };
      }),
    });

    const req = new Request('http://localhost/api/quotations/q-1/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'accepted' }),
    });

    const res = await updateStatus(req, { params: Promise.resolve({ id: 'q-1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.quotation.status).toBe('accepted');
  });
});
