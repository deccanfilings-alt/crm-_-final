import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockInsert = vi.fn();
const mockHistoryInsert = vi.fn().mockResolvedValue({ data: null, error: null });
const mockUpdate = vi.fn().mockReturnValue({
  eq: vi.fn().mockResolvedValue({ data: null, error: null }),
});

let mockExistingTasks: any[] = [];
let mockOpenTasksForDocUpload: any[] = [];

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'accounts') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: 'acc-123' }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { user_id: 'user-admin' }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'action_items') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                in: vi.fn().mockReturnValue({
                  or: vi.fn().mockReturnValue({
                    limit: vi.fn().mockImplementation(() => {
                      return Promise.resolve({ data: mockExistingTasks, error: null });
                    }),
                  }),
                }),
              }),
              in: vi.fn().mockReturnValue({
                or: vi.fn().mockImplementation(() => {
                  return Promise.resolve({ data: mockOpenTasksForDocUpload, error: null });
                }),
              }),
            }),
          }),
          insert: mockInsert,
          update: mockUpdate,
        };
      }
      if (table === 'action_item_history') {
        return {
          insert: mockHistoryInsert,
        };
      }
      return {};
    }),
  })),
}));

vi.mock('@/lib/contacts/dedupe', () => ({
  canonicalPhone: vi.fn((p) => p),
  findExistingContact: vi.fn().mockResolvedValue(null),
}));

describe('Orders Webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = 'test-secret';
    mockExistingTasks = [];
    mockOpenTasksForDocUpload = [];
  });

  it('rejects unauthenticated requests', async () => {
    const req = new Request('http://localhost/api/webhooks/orders', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-secret' },
      body: JSON.stringify({ order_id: 'ord-1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates task when order moves to Action Required', async () => {
    mockInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'task-order-1' },
          error: null,
        }),
      }),
    });

    const req = new Request('http://localhost/api/webhooks/orders', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        order_id: 'ord-100',
        order_number: 'ORD-100',
        status: 'Action Required',
        reason: 'Aadhar card copy unclear',
        service_name: 'GST Registration',
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.action).toBe('task_created');
    expect(json.task_id).toBe('task-order-1');

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Action Required: Order #ORD-100 - GST Registration',
        source: 'order',
        priority: 'high',
        status: 'todo',
      })
    );

    expect(mockHistoryInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action_item_id: 'task-order-1',
        action: 'created_from_order',
      })
    );
  });

  it('completes open order tasks automatically when client uploads documents', async () => {
    mockOpenTasksForDocUpload = [
      { id: 'task-order-1', title: 'Action Required: Order #ORD-100' },
    ];

    const req = new Request('http://localhost/api/webhooks/orders', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
      body: JSON.stringify({
        order_id: 'ord-100',
        order_number: 'ORD-100',
        action: 'documents_uploaded',
        documents: ['aadhar_new.pdf'],
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.action).toBe('tasks_completed');
    expect(json.completed_count).toBe(1);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
      })
    );

    expect(mockHistoryInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action_item_id: 'task-order-1',
        action: 'completed_automatically_by_document_upload',
      })
    );
  });
});
