import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const {
  mockUser,
  mockProfile,
  mockRpc,
  mockRpcData,
} = vi.hoisted(() => {
  const mockRpcData = [
    {
      user_id: 'user-ravi',
      full_name: 'Ravi Staff',
      team: 'registrations',
      open_count: 5,
      overdue_count: 2,
      due_today_count: 1,
      completed_count: 8,
      completed_on_time: 7,
      avg_days_late: 1.2,
      oldest_overdue_date: '2026-10-21',
    },
    {
      user_id: 'user-priya',
      full_name: 'Priya Leader',
      team: 'accounting',
      open_count: 2,
      overdue_count: 0,
      due_today_count: 2,
      completed_count: 10,
      completed_on_time: 10,
      avg_days_late: 0,
      oldest_overdue_date: null,
    },
  ];

  const mockRpc = vi.fn().mockResolvedValue({ data: mockRpcData, error: null });

  return {
    mockUser: { id: 'admin-1' },
    mockProfile: { account_id: 'acc-1', account_role: 'admin' },
    mockRpc,
    mockRpcData,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
            })),
          })),
        };
      }
      return {};
    }),
    rpc: mockRpc,
  }),
}));

describe('GET /api/action-items/stats - Task 5', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.id = 'admin-1';
    mockProfile.account_role = 'admin';
  });

  it('returns 403 Forbidden for non-admin agents', async () => {
    mockProfile.account_role = 'agent';

    const req = new Request('http://localhost/api/action-items/stats');
    const res = await GET(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden: Admins only');
  });

  it('calls task_stats RPC with default Mon-Sun range in IST for admins', async () => {
    const req = new Request('http://localhost/api/action-items/stats');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith(
      'task_stats',
      expect.objectContaining({
        p_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        p_to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    );

    const json = await res.json();
    expect(json.length).toBe(2);
    expect(json[0].user_id).toBe('user-ravi');
  });

  it('accepts custom from and to date query parameters', async () => {
    const req = new Request('http://localhost/api/action-items/stats?from=2026-10-01&to=2026-10-15');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(mockRpc).toHaveBeenCalledWith('task_stats', {
      p_from: '2026-10-01',
      p_to: '2026-10-15',
    });
  });
});
