import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { PATCH, DELETE } from './[id]/route';

let mockCurrentUser: { id: string } | null = null;
let mockCallerProfile: { account_id: string; account_role: string } | null = null;
let mockTargetProfile: { user_id: string } | null = null;
let mockExistingTarget: { id: string; user_id: string; account_id: string } | null = null;
let mockInsertCall: any = null;
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
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((col1: string, val1: string) => ({
              single: vi.fn().mockImplementation(() => {
                if (val1 === mockCurrentUser?.id) {
                  return Promise.resolve({ data: mockCallerProfile, error: null });
                }
                return Promise.resolve({ data: null, error: { message: 'Not found' } });
              }),
              eq: vi.fn().mockImplementation((col2: string, val2: string) => ({
                maybeSingle: vi.fn().mockImplementation(() => {
                  if (val1 === mockTargetProfile?.user_id) {
                    return Promise.resolve({ data: mockTargetProfile, error: null });
                  }
                  return Promise.resolve({ data: null, error: null });
                }),
              })),
              in: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          }),
        };
      }
      if (table === 'user_targets') {
        const queryChain: any = {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'target-1',
                    user_id: 'member-1',
                    created_by: 'admin-1',
                    title: 'Close 10 deals',
                    period_type: 'weekly',
                    period_start_date: '2026-10-26',
                    status: 'planned',
                  },
                ],
                error: null,
              }),
              maybeSingle: vi.fn().mockImplementation(() => {
                return Promise.resolve({ data: mockExistingTarget, error: null });
              }),
              single: vi.fn().mockImplementation(() => {
                return Promise.resolve({ data: mockExistingTarget, error: null });
              }),
            }),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'new-target-1',
                user_id: mockInsertCall?.user_id,
                created_by: mockInsertCall?.created_by,
                title: mockInsertCall?.title,
              },
              error: null,
            }),
          }),
          insert: vi.fn().mockImplementation((payload: any) => {
            mockInsertCall = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'new-target-1', ...payload }, error: null }),
              }),
            };
          }),
          update: vi.fn().mockImplementation((payload: any) => {
            mockUpdateCall = payload;
            return {
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 'target-1', ...payload }, error: null }),
                }),
              }),
            };
          }),
          delete: vi.fn().mockImplementation(() => {
            mockDeleteCall = true;
            return {
              eq: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }),
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockImplementation(() => {
              return Promise.resolve({ data: mockExistingTarget, error: null });
            }),
          }),
        };
        return queryChain;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  })),
}));

describe('Task 8: Admins manage team targets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUser = null;
    mockCallerProfile = null;
    mockTargetProfile = null;
    mockExistingTarget = null;
    mockInsertCall = null;
    mockUpdateCall = null;
    mockDeleteCall = null;
  });

  describe('POST /api/user-targets', () => {
    it('allows admin to create target for a team member and sets created_by', async () => {
      mockCurrentUser = { id: 'admin-1' };
      mockCallerProfile = { account_id: 'acc-1', account_role: 'admin' };
      mockTargetProfile = { user_id: 'member-2' };

      const req = new Request('http://localhost/api/user-targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'member-2',
          title: 'Hit 20 calls/day',
          period_type: 'weekly',
          period_start_date: '2026-10-26',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      expect(mockInsertCall).toEqual(
        expect.objectContaining({
          account_id: 'acc-1',
          user_id: 'member-2',
          created_by: 'admin-1',
          title: 'Hit 20 calls/day',
        })
      );
    });

    it('forces regular agent to create targets only for themselves', async () => {
      mockCurrentUser = { id: 'agent-1' };
      mockCallerProfile = { account_id: 'acc-1', account_role: 'agent' };

      const req = new Request('http://localhost/api/user-targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: 'other-agent', // attempting to set for someone else
          title: 'My personal target',
          period_type: 'weekly',
          period_start_date: '2026-10-26',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      // Should be forced to caller ID
      expect(mockInsertCall).toEqual(
        expect.objectContaining({
          account_id: 'acc-1',
          user_id: 'agent-1',
          created_by: 'agent-1',
        })
      );
    });
  });

  describe('PATCH & DELETE /api/user-targets/[id]', () => {
    it('rejects agent trying to edit someone elses target with 403', async () => {
      mockCurrentUser = { id: 'agent-1' };
      mockCallerProfile = { account_id: 'acc-1', account_role: 'agent' };
      mockExistingTarget = { id: 'target-99', user_id: 'agent-2', account_id: 'acc-1' };

      const req = new Request('http://localhost/api/user-targets/target-99', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Hacked title' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'target-99' }) });
      expect(res.status).toBe(403);
    });

    it('allows admin to edit any team members target', async () => {
      mockCurrentUser = { id: 'admin-1' };
      mockCallerProfile = { account_id: 'acc-1', account_role: 'admin' };
      mockExistingTarget = { id: 'target-99', user_id: 'agent-2', account_id: 'acc-1' };

      const req = new Request('http://localhost/api/user-targets/target-99', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated by Admin' }),
      });

      const res = await PATCH(req, { params: Promise.resolve({ id: 'target-99' }) });
      expect(res.status).toBe(200);
      expect(mockUpdateCall).toEqual({ title: 'Updated by Admin' });
    });

    it('allows admin to delete a team members target', async () => {
      mockCurrentUser = { id: 'admin-1' };
      mockCallerProfile = { account_id: 'acc-1', account_role: 'admin' };
      mockExistingTarget = { id: 'target-99', user_id: 'agent-2', account_id: 'acc-1' };

      const req = new Request('http://localhost/api/user-targets/target-99', {
        method: 'DELETE',
      });

      const res = await DELETE(req, { params: Promise.resolve({ id: 'target-99' }) });
      expect(res.status).toBe(200);
      expect(mockDeleteCall).toBe(true);
    });
  });
});
