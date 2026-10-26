import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as digestGet } from './task-digest/route';
import { GET as remindersGet } from './task-reminders/route';

const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
});

let mockTasksData: any[] = [];
let mockProfilesData: any[] = [];
let mockToEscalateData: any[] = [];
let mockRemindersData: any[] = [];

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'notifications') {
        return {
          insert: mockInsert,
        };
      }
      if (table === 'action_items') {
        return {
          select: vi.fn((cols: string) => {
            return {
              not: vi.fn().mockReturnValue({
                lte: vi.fn().mockImplementation(() => {
                  return Promise.resolve({ data: mockTasksData, error: null });
                }),
                is: vi.fn().mockReturnValue({
                  gte: vi.fn().mockReturnValue({
                    lte: vi.fn().mockImplementation(() => {
                      return Promise.resolve({ data: mockRemindersData, error: null });
                    }),
                  }),
                }),
              }),
              lte: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  not: vi.fn().mockImplementation(() => {
                    return Promise.resolve({ data: mockToEscalateData, error: null });
                  }),
                }),
              }),
              then: (resolve: any) => resolve({ data: mockTasksData, error: null }),
            };
          }),
          update: mockUpdate,
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: mockProfilesData, error: null }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        insert: mockInsert,
        update: mockUpdate,
      };
    }),
  })),
}));

describe('Task 6: Task Digest and Reminders Cron', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    vi.clearAllMocks();
    mockTasksData = [];
    mockProfilesData = [];
    mockToEscalateData = [];
    mockRemindersData = [];
  });

  afterEach(() => {
    process.env = origEnv;
    vi.useRealTimers();
  });

  describe('Authorization checks', () => {
    it('returns 503 in production when CRON_SECRET is unset', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.CRON_SECRET;

      const req = new Request('http://localhost/api/cron/task-digest?slot=morning');
      const res = await digestGet(req);
      expect(res.status).toBe(503);
    });

    it('returns 401 when authorization header is invalid', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CRON_SECRET = 'my-cron-secret';

      const req = new Request('http://localhost/api/cron/task-digest?slot=morning', {
        headers: { authorization: 'Bearer wrong' },
      });
      const res = await digestGet(req);
      expect(res.status).toBe(401);
    });

    it('returns 401 for task-reminders when secret is wrong', async () => {
      process.env.NODE_ENV = 'production';
      process.env.CRON_SECRET = 'my-cron-secret';

      const req = new Request('http://localhost/api/cron/task-reminders', {
        headers: { authorization: 'Bearer wrong' },
      });
      const res = await remindersGet(req);
      expect(res.status).toBe(401);
    });
  });

  describe('Morning Digest (slot=morning)', () => {
    it('skips morning digest on Sundays', async () => {
      process.env.CRON_SECRET = 'test-secret';
      // Mock date to a Sunday (e.g., 2026-10-25 is Sunday)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-25T04:00:00Z')); // 09:30 IST on Sunday

      const req = new Request('http://localhost/api/cron/task-digest?slot=morning', {
        headers: { authorization: 'Bearer test-secret' },
      });
      const res = await digestGet(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.skipped).toBe(true);
      expect(data.reason).toBe('Sunday');
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it('sends summary of due and overdue tasks to assignee on weekdays', async () => {
      process.env.CRON_SECRET = 'test-secret';
      // Mock date to a Monday (2026-10-26)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-26T04:00:00Z'));

      mockTasksData = [
        {
          id: 't-1',
          title: 'Prepare GST filing',
          account_id: 'acc-1',
          assignee_id: 'user-1',
          target_date: '2026-10-26', // due today
          status: 'pending',
        },
        {
          id: 't-2',
          title: 'Follow up invoice #102',
          account_id: 'acc-1',
          assignee_id: 'user-1',
          target_date: '2026-10-24', // overdue
          status: 'in_progress',
        },
      ];

      const req = new Request('http://localhost/api/cron/task-digest?slot=morning', {
        headers: { authorization: 'Bearer test-secret' },
      });
      const res = await digestGet(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.notificationsSent).toBe(1);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: 'acc-1',
          user_id: 'user-1',
          type: 'task_assigned',
          title: 'Your day: 1 tasks today, 1 overdue',
          link: '/action-items',
        })
      );
    });
  });

  describe('Evening Digest & Escalation (slot=evening)', () => {
    it('sends evening summary to admins and escalates 2+ days overdue tasks', async () => {
      process.env.CRON_SECRET = 'test-secret';
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-26T12:30:00Z')); // 18:00 IST

      mockTasksData = [
        {
          id: 't-1',
          title: 'Task Done',
          account_id: 'acc-1',
          assignee_id: 'user-1',
          target_date: '2026-10-26',
          status: 'completed',
          assignee: { full_name: 'Ravi', team: 'Sales' },
        },
        {
          id: 't-2',
          title: 'Task Pending Today',
          account_id: 'acc-1',
          assignee_id: 'user-2',
          target_date: '2026-10-26',
          status: 'pending',
          assignee: { full_name: 'Priya', team: 'Support' },
        },
        {
          id: 't-3',
          title: 'Old Task',
          account_id: 'acc-1',
          assignee_id: 'user-2',
          target_date: '2026-10-20',
          status: 'pending',
          assignee: { full_name: 'Priya', team: 'Support' },
        },
      ];

      mockProfilesData = [
        {
          user_id: 'admin-1',
          account_id: 'acc-1',
          full_name: 'Admin Boss',
          team: 'Sales',
          account_role: 'admin',
        },
      ];

      mockToEscalateData = [
        {
          id: 't-3',
          title: 'Old Task',
          account_id: 'acc-1',
          assignee_id: 'user-2',
          target_date: '2026-10-20',
          assignee: { full_name: 'Priya', team: 'Support' },
        },
      ];

      const req = new Request('http://localhost/api/cron/task-digest?slot=evening', {
        headers: { authorization: 'Bearer test-secret' },
      });
      const res = await digestGet(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.adminSummariesSent).toBe(1);
      expect(data.escalatedCount).toBe(1);

      // Verify evening digest notification
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: 'acc-1',
          user_id: 'admin-1',
          link: '/team-action-items',
        })
      );

      // Verify escalation notification
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: 'acc-1',
          user_id: 'admin-1',
          title: 'Overdue 2+ days: Old Task (Priya)',
          link: '/team-action-items?task=t-3',
        })
      );

      // Verify escalated_at was updated on task
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          escalated_at: expect.any(String),
        })
      );
    });
  });

  describe('Task Reminders (GET /api/cron/task-reminders)', () => {
    it('notifies assignee for tasks due within 60 mins and sets reminded_at', async () => {
      process.env.CRON_SECRET = 'test-secret';
      const dueTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      mockRemindersData = [
        {
          id: 't-due-soon',
          title: 'Sign contract',
          account_id: 'acc-1',
          assignee_id: 'user-1',
          due_at: dueTime,
        },
      ];

      const req = new Request('http://localhost/api/cron/task-reminders', {
        headers: { authorization: 'Bearer test-secret' },
      });
      const res = await remindersGet(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.remindersSent).toBe(1);

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: 'acc-1',
          user_id: 'user-1',
          type: 'task_assigned',
          link: '/action-items?task=t-due-soon',
        })
      );

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          reminded_at: expect.any(String),
        })
      );
    });
  });
});
