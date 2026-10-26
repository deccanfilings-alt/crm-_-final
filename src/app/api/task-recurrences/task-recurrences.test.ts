import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';
import { POST as cronPOST } from '../cron/task-recurrences/route';

let mockUser: { id: string } | null = null;
let mockProfile: { account_id: string } | null = null;
let mockRecurrences: any[] = [];
let mockInsertedTask: any = null;
let mockUpdatedRecurrence: any = null;

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: {
      getUser: vi.fn().mockImplementation(() =>
        Promise.resolve({ data: { user: mockUser }, error: null })
      ),
    },
    from: vi.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
            }),
          }),
        };
      }
      if (table === 'task_recurrences') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockRecurrences, error: null }),
            }),
          }),
          insert: vi.fn().mockImplementation((payload) => ({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'rec-1', ...payload }, error: null }),
            }),
          })),
        };
      }
      return {};
    }),
  })),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn().mockImplementation(() => ({
    from: vi.fn((table: string) => {
      if (table === 'task_recurrences') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: mockRecurrences, error: null }),
          }),
          update: vi.fn().mockImplementation((payload) => {
            mockUpdatedRecurrence = payload;
            return {
              eq: vi.fn().mockResolvedValue({ error: null }),
            };
          }),
        };
      }
      if (table === 'action_items') {
        return {
          insert: vi.fn().mockImplementation((payload) => {
            mockInsertedTask = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'generated-task-1', ...payload },
                  error: null,
                }),
              }),
            };
          }),
        };
      }
      if (table === 'action_item_history') {
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    }),
  })),
}));

describe('Task Recurrences & Cron API', () => {
  beforeEach(() => {
    mockUser = { id: 'user-1' };
    mockProfile = { account_id: 'acc-1' };
    mockRecurrences = [
      {
        id: 'rec-1',
        account_id: 'acc-1',
        title: 'Monthly GST Return Filing',
        description: 'Prepare and file GSTR-3B',
        assignee_id: 'user-1',
        created_by: 'user-1',
        priority: 'high',
        contact_id: 'client-1',
        frequency: 'monthly',
        day_of_month: 20,
        lead_days: 3,
        next_due_date: '2026-10-28',
        active: true,
      },
    ];
    mockInsertedTask = null;
    mockUpdatedRecurrence = null;
  });

  it('GET returns 401 when unauthenticated', async () => {
    mockUser = null;
    const req = new Request('http://localhost/api/task-recurrences');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('GET returns recurrences for account', async () => {
    const req = new Request('http://localhost/api/task-recurrences');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].title).toBe('Monthly GST Return Filing');
  });

  it('POST rejects missing required fields', async () => {
    const req = new Request('http://localhost/api/task-recurrences', {
      method: 'POST',
      body: JSON.stringify({ title: 'Incomplete' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('POST creates recurrence schedule successfully', async () => {
    const req = new Request('http://localhost/api/task-recurrences', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Quarterly Advance Tax Review',
        frequency: 'quarterly',
        day_of_month: 15,
        lead_days: 5,
        next_due_date: '2026-12-15',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.frequency).toBe('quarterly');
    expect(data.next_due_date).toBe('2026-12-15');
  });

  it('Cron POST generates recurring tasks when within lead days and moves next_due_date forward', async () => {
    const req = new Request('http://localhost/api/cron/task-recurrences', {
      method: 'POST',
    });
    const res = await cronPOST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.generated).toBe(1);
    expect(mockInsertedTask).toMatchObject({
      title: 'Monthly GST Return Filing',
      source: 'recurring',
      target_date: '2026-10-28',
    });
    expect(mockUpdatedRecurrence).toMatchObject({
      next_due_date: '2026-11-20',
    });
  });
});
