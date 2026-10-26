import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

const {
  mockUser,
  mockProfile,
  mockTasks,
  mockGte,
  mockLte,
  mockEq,
  mockNot,
  mockLt,
  mockNeq,
  mockInsert,
  mockNotificationInsert,
} = vi.hoisted(() => {
  const mockInsert = vi.fn();
  const mockNotificationInsert = vi.fn().mockResolvedValue({ error: null });

  const mockTasks = [
    {
      id: 'task-low',
      priority: 'low',
      due_at: null,
      created_at: '2026-10-24T10:00:00Z',
      target_date: '2026-10-24',
    },
    {
      id: 'task-urgent',
      priority: 'urgent',
      due_at: '2026-10-24T14:00:00Z',
      created_at: '2026-10-24T12:00:00Z',
      target_date: '2026-10-24',
    },
    {
      id: 'task-normal-due',
      priority: 'normal',
      due_at: '2026-10-24T15:00:00Z',
      created_at: '2026-10-24T09:00:00Z',
      target_date: '2026-10-24',
    },
    {
      id: 'task-normal-nodue',
      priority: 'normal',
      due_at: null,
      created_at: '2026-10-24T08:00:00Z',
      target_date: '2026-10-24',
    },
  ];

  const mockGte = vi.fn();
  const mockLte = vi.fn();
  const mockEq = vi.fn();
  const mockNot = vi.fn();
  const mockLt = vi.fn();
  const mockNeq = vi.fn();

  return {
    mockUser: { id: 'user-creator-1' },
    mockProfile: { account_id: 'acc-1', full_name: 'Creator Admin' },
    mockTasks,
    mockGte,
    mockLte,
    mockEq,
    mockNot,
    mockLt,
    mockNeq,
    mockInsert,
    mockNotificationInsert,
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
              single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
            })),
          })),
        };
      }
      if (table === 'action_items') {
        const queryBuilder: any = {
          select: vi.fn(() => queryBuilder),
          eq: vi.fn((field: string, val: string) => {
            mockEq(field, val);
            return queryBuilder;
          }),
          not: vi.fn((...args: any[]) => {
            mockNot(...args);
            return queryBuilder;
          }),
          gte: vi.fn((field: string, val: string) => {
            mockGte(field, val);
            return queryBuilder;
          }),
          lte: vi.fn((field: string, val: string) => {
            mockLte(field, val);
            return queryBuilder;
          }),
          lt: vi.fn((field: string, val: string) => {
            mockLt(field, val);
            return queryBuilder;
          }),
          neq: vi.fn((field: string, val: string) => {
            mockNeq(field, val);
            return queryBuilder;
          }),
          insert: vi.fn((data: any) => {
            mockInsert(data);
            return {
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: { id: 'new-task-99', ...data }, error: null }),
              })),
            };
          }),
          then: (resolve: any) => resolve({ data: [...mockTasks], error: null }),
        };
        return queryBuilder;
      }
      if (table === 'notifications') {
        return {
          insert: mockNotificationInsert,
        };
      }
      return {};
    }),
  }),
}));

describe('GET & POST /api/action-items - Task 4 fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('week_start filter applies both gte and lte bounds (weekStart + 6 days)', async () => {
    const req = new Request('http://localhost/api/action-items?week_start=2026-10-19');
    const res = await GET(req);
    expect(res.status).toBe(200);

    expect(mockGte).toHaveBeenCalledWith('target_date', '2026-10-19');
    expect(mockLte).toHaveBeenCalledWith('target_date', '2026-10-25');
  });

  it('sorts returned tasks by priority (urgent -> low), due_at, then created_at', async () => {
    const req = new Request('http://localhost/api/action-items');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json[0].id).toBe('task-urgent'); // urgent first
    expect(json[1].id).toBe('task-normal-due'); // normal with due_at before normal without due_at
    expect(json[2].id).toBe('task-normal-nodue');
    expect(json[3].id).toBe('task-low'); // low priority last
  });

  it('POST links notifications to /action-items?task=<id> instead of dead /tasks', async () => {
    const req = new Request('http://localhost/api/action-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Review quarterly numbers',
        assignee_id: 'user-member-2',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockNotificationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-member-2',
        link: '/action-items?task=new-task-99',
      })
    );
  });
});
