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

  function statusClient(currentStatus: string, mockUpdate = vi.fn().mockReturnThis()) {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      update: mockUpdate,
      eq: vi.fn(() => chain),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn().mockResolvedValue({ data: { status: currentStatus } }),
      single: vi.fn(async () => ({ data: { id: 'q-1', status: (mockUpdate.mock.calls.at(-1)?.[0] as any)?.status }, error: null })),
    });
    return {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }) },
      from: vi.fn((table: string) =>
        table === 'profiles'
          ? { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: mockProfile }) }
          : chain,
      ),
    };
  }
  const statusReq = (status: string) =>
    updateStatus(
      new Request('http://localhost/api/quotations/q-1/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
      { params: Promise.resolve({ id: 'q-1' }) },
    );

  it('updates status to the new Draft / Final / Cancelled values', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const mockUpdate = vi.fn().mockReturnThis();
    (createClient as any).mockResolvedValue(statusClient('draft', mockUpdate));
    const res = await statusReq('final');
    expect(res.status).toBe(200);
    expect((await res.json()).quotation.status).toBe('final');
  });

  it('maps legacy status names (accepted -> final, rejected -> cancelled)', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const mockUpdate = vi.fn().mockReturnThis();
    (createClient as any).mockResolvedValue(statusClient('final', mockUpdate));
    await statusReq('accepted');
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({ status: 'final', accepted_at: expect.any(String) });
    await statusReq('rejected');
    expect(mockUpdate.mock.calls[1][0]).toMatchObject({ status: 'cancelled', rejected_at: expect.any(String) });
  });

  it('rejects unknown statuses and changes to an invoiced quotation', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as any).mockResolvedValue(statusClient('draft'));
    expect((await statusReq('invoiced')).status).toBe(400);
    expect((await statusReq('bogus')).status).toBe(400);
    (createClient as any).mockResolvedValue(statusClient('invoiced'));
    expect((await statusReq('draft')).status).toBe(409);
  });
});
