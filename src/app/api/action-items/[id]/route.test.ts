import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH, DELETE } from './route';

const {
  mockUser,
  mockProfile,
  mockExistingTask,
  mockEvents,
  mockProfilesList,
  mockUpdate,
  mockEq,
  mockSelect,
  mockSingle,
  mockInsertNotification,
} = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockSelect = vi.fn(() => ({ single: mockSingle }));
  const mockEq = vi.fn(() => ({ select: mockSelect, maybeSingle: mockSingle }));
  const mockUpdate = vi.fn(() => ({ eq: mockEq }));
  const mockDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  const mockInsertNotification = vi.fn().mockResolvedValue({ data: null, error: null });

  const mockEvents = [
    {
      id: 'event-1',
      action_item_id: 'task-123',
      account_id: 'acc-1',
      actor_id: 'user-creator-9',
      event: 'created',
      to_value: 'user-assignee-1',
      created_at: '2026-10-24T10:00:00Z',
    },
    {
      id: 'event-2',
      action_item_id: 'task-123',
      account_id: 'acc-1',
      actor_id: 'user-assignee-1',
      event: 'status_changed',
      from_value: 'todo',
      to_value: 'completed',
      created_at: '2026-10-25T11:20:00Z',
    },
  ];

  const mockProfilesList = [
    { user_id: 'user-creator-9', full_name: 'Priya Leader', avatar_url: null },
    { user_id: 'user-assignee-1', full_name: 'Ravi Staff', avatar_url: null },
  ];

  return {
    mockUser: { id: 'user-assignee-1' },
    mockProfile: { account_id: 'acc-1', account_role: 'agent' },
    mockExistingTask: {
      id: 'task-123',
      account_id: 'acc-1',
      agent_id: 'user-creator-9',
      assignee_id: 'user-assignee-1',
      status: 'todo',
      title: 'Original Title',
      agent: { full_name: 'Priya Leader' },
    },
    mockEvents,
    mockProfilesList,
    mockUpdate,
    mockDelete,
    mockEq,
    mockSelect,
    mockSingle,
    mockInsertNotification,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'action_items') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: mockExistingTask, error: null }),
            })),
          })),
          update: mockUpdate,
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }
      if (table === 'action_item_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: mockEvents, error: null }),
            })),
          })),
        };
      }
      if (table === 'profiles') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: mockProfile, error: null }),
            })),
            in: vi.fn().mockResolvedValue({ data: mockProfilesList, error: null }),
          })),
        };
      }
      return {};
    }),
  }),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn().mockReturnValue({
    from: vi.fn(() => ({
      insert: mockInsertNotification,
    })),
  }),
}));

describe('GET /api/action-items/[id] - Task 3 History & Events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns task with joined events and enriched actor profiles', async () => {
    const req = new Request('http://localhost/api/action-items/task-123');
    const res = await GET(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.id).toBe('task-123');
    expect(json.events).toBeDefined();
    expect(json.events.length).toBe(2);
    expect(json.events[0].actor?.full_name).toBe('Priya Leader');
    expect(json.events[1].actor?.full_name).toBe('Ravi Staff');
  });
});

describe('PATCH & DELETE /api/action-items/[id] - Task 2 Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.id = 'user-assignee-1';
    mockProfile.account_role = 'agent';
    mockExistingTask.agent_id = 'user-creator-9';
    mockExistingTask.assignee_id = 'user-assignee-1';
    mockExistingTask.status = 'todo';

    mockSingle.mockResolvedValue({
      data: { id: 'task-123', title: 'Updated task title' },
      error: null,
    });
  });

  it('an assignee-only user updating title returns 403', async () => {
    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Assignee trying to rename task' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('Only Priya Leader or an admin can change this');
  });

  it('an assignee-only user can update status and description', async () => {
    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress', description: 'Progress note' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'in_progress',
        description: 'Progress note',
      })
    );
  });

  it('an admin can reassign another person\'s task, notifying the new assignee', async () => {
    mockUser.id = 'admin-user-7';
    mockProfile.account_role = 'admin';

    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_id: 'new-member-88' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ assignee_id: 'new-member-88' })
    );
    expect(mockInsertNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'new-member-88',
        type: 'task_assigned',
      })
    );
  });

  it('an assignee trying to delete returns 403', async () => {
    mockUser.id = 'user-assignee-1';
    mockProfile.account_role = 'agent';

    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Ask the person who created this task, or an admin.');
  });

  it('cancelling without a reason returns 400', async () => {
    mockUser.id = 'user-creator-9'; // creator

    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Cancellation reason is required');
  });

  it('creator or admin can cancel with a reason', async () => {
    mockUser.id = 'user-creator-9'; // creator

    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled', cancel_reason: 'Client cancelled deal' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'cancelled',
        cancel_reason: 'Client cancelled deal',
        cancelled_at: expect.any(String),
      })
    );
  });
  it('when assignee marks task with requires_review: true as completed, it reroutes to review status', async () => {
    mockUser.id = 'user-assignee-1';
    mockProfile.account_role = 'agent';
    mockExistingTask.requires_review = true;

    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'review',
      })
    );
  });

  it('when creator or admin completes task with requires_review, it completes and sets completed_at', async () => {
    mockUser.id = 'user-creator-9';
    mockProfile.account_role = 'admin';
    mockExistingTask.requires_review = true;

    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        completed_at: expect.any(String),
      })
    );
  });
});