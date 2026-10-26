import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { PATCH, DELETE } from './[id]/route';

let mockCurrentUser: { id: string } | null = null;
let mockCallerProfile: { account_id: string; account_role: string } | null = null;
let mockTargetProfile: { user_id: string; account_role?: string } | null = null;
let mockExistingTarget: { id: string; user_id: string; account_id: string; created_by: string } | null = null;
let mockRpcRows: any[] = [];
let mockUpsertCall: any = null;
let mockUpdateCall: any = null;
let mockDeleteCall: any = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: {
      getUser: vi.fn().mockImplementation(() =>
        Promise.resolve({
          data: { user: mockCurrentUser },
          error: null,
        })
      ),
    },
    rpc: vi.fn().mockImplementation((name: string) => {
      if (name === 'kpi_progress') {
        return Promise.resolve({ data: mockRpcRows, error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'RPC not found' } });
    }),
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_col: string, val: string) => ({
              single: vi.fn().mockImplementation(() => {
                if (val === mockCurrentUser?.id) {
                  return Promise.resolve({ data: mockCallerProfile, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              }),
              eq: vi.fn().mockImplementation((_col2: string, _val2: string) => ({
                maybeSingle: vi.fn().mockImplementation(() => {
                  if (val === mockTargetProfile?.user_id) {
                    return Promise.resolve({ data: mockTargetProfile, error: null });
                  }
                  return Promise.resolve({ data: null, error: null });
                }),
              })),
            })),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  user_id: 'member-1',
                  full_name: 'Frontline Agent',
                  avatar_url: null,
                  account_role: 'agent',
                  team: 'GST',
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === 'kpi_targets') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((col: string, val: string) => ({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockImplementation(() => {
                  if (val === mockExistingTarget?.id) {
                    return Promise.resolve({ data: mockExistingTarget, error: null });
                  }
                  return Promise.resolve({ data: null, error: null });
                }),
              }),
            })),
          }),
          upsert: vi.fn().mockImplementation((payload: any) => {
            mockUpsertCall = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'kpi-target-1', ...payload },
                  error: null,
                }),
              }),
            };
          }),
          update: vi.fn().mockImplementation((payload: any) => {
            mockUpdateCall = payload;
            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'kpi-target-1', ...payload },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          }),
          delete: vi.fn().mockImplementation(() => {
            mockDeleteCall = true;
            return {
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            };
          }),
        };
      }
      return {};
    }),
  })),
}));

describe('KPI Targets API', () => {
  beforeEach(() => {
    mockCurrentUser = { id: 'user-admin-1' };
    mockCallerProfile = { account_id: 'acc-1', account_role: 'admin' };
    mockTargetProfile = { user_id: 'member-1', account_role: 'agent' };
    mockExistingTarget = {
      id: 'target-1',
      user_id: 'member-1',
      created_by: 'user-admin-1',
      account_id: 'acc-1',
    };
    mockRpcRows = [
      {
        target_id: 'target-1',
        user_id: 'member-1',
        metric: 'tasks_completed_on_time',
        period: 'week',
        period_start: '2026-10-26',
        target_value: 20,
        actual_value: 16,
        percentage: 80.0,
      },
    ];
    mockUpsertCall = null;
    mockUpdateCall = null;
    mockDeleteCall = null;
  });

  it('GET returns 401 when unauthenticated', async () => {
    mockCurrentUser = null;
    const req = new Request('http://localhost/api/kpi-targets');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('GET computes live KPI progress via RPC and enriches profiles', async () => {
    const req = new Request('http://localhost/api/kpi-targets?period=week&period_start=2026-10-26');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].metric).toBe('tasks_completed_on_time');
    expect(data[0].percentage).toBe(80.0);
    expect(data[0].user.full_name).toBe('Frontline Agent');
  });

  it('POST rejects invalid metric with 400', async () => {
    const req = new Request('http://localhost/api/kpi-targets', {
      method: 'POST',
      body: JSON.stringify({
        metric: 'invalid_metric',
        period: 'week',
        period_start: '2026-10-26',
        target_value: 10,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('POST prevents subordinates from assigning targets to owner', async () => {
    mockCallerProfile = { account_id: 'acc-1', account_role: 'admin' };
    mockTargetProfile = { user_id: 'owner-1', account_role: 'owner' };
    const req = new Request('http://localhost/api/kpi-targets', {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'owner-1',
        metric: 'deals_won',
        period: 'week',
        period_start: '2026-10-26',
        target_value: 5,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('POST upserts valid KPI target for team member', async () => {
    const req = new Request('http://localhost/api/kpi-targets', {
      method: 'POST',
      body: JSON.stringify({
        user_id: 'member-1',
        metric: 'deals_won',
        period: 'week',
        period_start: '2026-10-26',
        target_value: 15,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockUpsertCall).toMatchObject({
      user_id: 'member-1',
      metric: 'deals_won',
      target_value: 15,
    });
  });

  it('PATCH updates target value', async () => {
    const req = new Request('http://localhost/api/kpi-targets/target-1', {
      method: 'PATCH',
      body: JSON.stringify({ target_value: 25 }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'target-1' }) });
    expect(res.status).toBe(200);
    expect(mockUpdateCall).toMatchObject({ target_value: 25 });
  });

  it('DELETE deletes target by ID', async () => {
    const req = new Request('http://localhost/api/kpi-targets/target-1', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'target-1' }) });
    expect(res.status).toBe(200);
    expect(mockDeleteCall).toBe(true);
  });
});
