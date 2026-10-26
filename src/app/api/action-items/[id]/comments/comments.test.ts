import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

let mockUser: { id: string } | null = null;
let mockProfile: { account_id: string; full_name: string } | null = null;
let mockTask: any = null;
let mockComments: any[] = [];
let mockInsertedComment: any = null;
let mockInsertedNotification: any = null;
let mockInsertedHistory: any = null;

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
      if (table === 'action_items') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_c1: string, val1: string) => ({
              eq: vi.fn().mockImplementation((_c2: string, _val2: string) => ({
                maybeSingle: vi.fn().mockImplementation(() => {
                  if (val1 === mockTask?.id) {
                    return Promise.resolve({ data: mockTask, error: null });
                  }
                  return Promise.resolve({ data: null, error: null });
                }),
              })),
            })),
          }),
        };
      }
      if (table === 'task_comments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockComments, error: null }),
            }),
          }),
          insert: vi.fn().mockImplementation((payload) => {
            mockInsertedComment = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'comm-1', ...payload },
                  error: null,
                }),
              }),
            };
          }),
        };
      }
      if (table === 'action_item_history') {
        return {
          insert: vi.fn().mockImplementation((payload) => {
            mockInsertedHistory = payload;
            return Promise.resolve({ error: null });
          }),
        };
      }
      if (table === 'notifications') {
        return {
          insert: vi.fn().mockImplementation((payload) => {
            mockInsertedNotification = payload;
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {};
    }),
  })),
}));

describe('Task Comments API', () => {
  beforeEach(() => {
    mockUser = { id: 'user-author-1' };
    mockProfile = { account_id: 'acc-1', full_name: 'Author Name' };
    mockTask = {
      id: 'task-1',
      title: 'Review balance sheet',
      account_id: 'acc-1',
      assignee_id: 'user-assignee-2',
      agent_id: 'user-creator-3',
    };
    mockComments = [
      {
        id: 'comm-1',
        action_item_id: 'task-1',
        author_id: 'user-author-1',
        body: 'Please check schedule III format.',
        attachments: [],
        created_at: '2026-10-27T00:00:00Z',
      },
    ];
    mockInsertedComment = null;
    mockInsertedNotification = null;
    mockInsertedHistory = null;
  });

  it('GET returns 401 when unauthenticated', async () => {
    mockUser = null;
    const req = new Request('http://localhost/api/action-items/task-1/comments');
    const res = await GET(req, { params: Promise.resolve({ id: 'task-1' }) });
    expect(res.status).toBe(401);
  });

  it('GET returns 404 when task not found', async () => {
    mockTask = null;
    const req = new Request('http://localhost/api/action-items/task-missing/comments');
    const res = await GET(req, { params: Promise.resolve({ id: 'task-missing' }) });
    expect(res.status).toBe(404);
  });

  it('GET returns comments for task', async () => {
    const req = new Request('http://localhost/api/action-items/task-1/comments');
    const res = await GET(req, { params: Promise.resolve({ id: 'task-1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveLength(1);
    expect(data[0].body).toContain('schedule III');
  });

  it('POST rejects empty body with 400', async () => {
    const req = new Request('http://localhost/api/action-items/task-1/comments', {
      method: 'POST',
      body: JSON.stringify({ body: '   ' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'task-1' }) });
    expect(res.status).toBe(400);
  });

  it('POST inserts comment, notifies assignee and creator, and logs history', async () => {
    const req = new Request('http://localhost/api/action-items/task-1/comments', {
      method: 'POST',
      body: JSON.stringify({
        body: 'Updated trial balance attached.',
        attachments: [{ name: 'tb.pdf', url: 'https://storage/tb.pdf' }],
      }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'task-1' }) });
    expect(res.status).toBe(200);
    expect(mockInsertedComment).toMatchObject({
      action_item_id: 'task-1',
      author_id: 'user-author-1',
      body: 'Updated trial balance attached.',
    });
    expect(mockInsertedHistory).toMatchObject({
      action: 'comment_added',
      action_item_id: 'task-1',
    });
    // Notifies both assignee-2 and creator-3
    expect(mockInsertedNotification).toHaveLength(2);
    expect(mockInsertedNotification[0].type).toBe('task_comment');
  });
});
