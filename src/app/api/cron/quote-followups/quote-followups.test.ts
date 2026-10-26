import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockActionItemsInsert = vi.fn();
const mockHistoryInsert = vi.fn().mockResolvedValue({ data: null, error: null });
let mockQuotesData: any[] = [];
let mockExistingTasksData: any[] = [];

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'quotations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lte: vi.fn().mockImplementation(() => {
                return Promise.resolve({ data: mockQuotesData, error: null });
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
                ilike: vi.fn().mockReturnValue({
                  limit: vi.fn().mockImplementation(() => {
                    return Promise.resolve({ data: mockExistingTasksData, error: null });
                  }),
                }),
              }),
            }),
          }),
          insert: mockActionItemsInsert,
        };
      }
      if (table === 'action_item_history') {
        return {
          insert: mockHistoryInsert,
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { user_id: 'fallback-user' }, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    }),
  })),
}));

describe('Quote Followups Cron Job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    mockQuotesData = [];
    mockExistingTasksData = [];
  });

  it('handles empty quotes gracefully', async () => {
    mockQuotesData = [];
    const req = new Request('http://localhost/api/cron/quote-followups', { method: 'POST' });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.processed).toBe(0);
    expect(json.generated).toBe(0);
  });

  it('generates follow-up task for quote sent >= 3 days ago', async () => {
    const sentDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    mockQuotesData = [
      {
        id: 'quote-123',
        account_id: 'acc-1',
        quote_number: 'DF-QT-1001',
        title: 'GST Registration Service',
        contact_id: 'contact-1',
        deal_id: 'deal-1',
        created_by_user_id: 'user-sales',
        status: 'sent',
        sent_at: sentDate,
      },
    ];
    mockExistingTasksData = []; // No existing task

    mockActionItemsInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'task-1' },
          error: null,
        }),
      }),
    });

    const req = new Request('http://localhost/api/cron/quote-followups', { method: 'POST' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.processed).toBe(1);
    expect(json.generated).toBe(1);

    expect(mockActionItemsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acc-1',
        assignee_id: 'user-sales',
        title: 'Follow up: Quote DF-QT-1001 not accepted in 3 days',
        source: 'quotation',
        priority: 'high',
        status: 'todo',
      })
    );

    expect(mockHistoryInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action_item_id: 'task-1',
        action: 'created_from_quotation_followup',
        details: expect.objectContaining({
          quotation_id: 'quote-123',
          quote_number: 'DF-QT-1001',
        }),
      })
    );
  });

  it('skips generating task if follow-up task already exists', async () => {
    const sentDate = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    mockQuotesData = [
      {
        id: 'quote-123',
        account_id: 'acc-1',
        quote_number: 'DF-QT-1001',
        title: 'GST Registration Service',
        contact_id: 'contact-1',
        deal_id: 'deal-1',
        created_by_user_id: 'user-sales',
        status: 'sent',
        sent_at: sentDate,
      },
    ];
    mockExistingTasksData = [{ id: 'existing-task-id' }]; // Task already exists!

    const req = new Request('http://localhost/api/cron/quote-followups', { method: 'POST' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.processed).toBe(1);
    expect(json.generated).toBe(0);
    expect(mockActionItemsInsert).not.toHaveBeenCalled();
  });
});
