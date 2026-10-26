import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './route';

const { mockUser, mockUpdate, mockEq, mockSelect, mockSingle } = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockSelect = vi.fn(() => ({ single: mockSingle }));
  const mockEq = vi.fn(() => ({ select: mockSelect }));
  const mockUpdate = vi.fn(() => ({ eq: mockEq }));
  return {
    mockUser: { id: 'test-user-uuid' },
    mockUpdate,
    mockEq,
    mockSelect,
    mockSingle,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    },
    from: vi.fn(() => ({
      update: mockUpdate,
    })),
  }),
}));

describe('PATCH /api/action-items/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({
      data: { id: 'task-123', title: 'Updated task title' },
      error: null,
    });
  });

  it('drops agent and assignee joined objects and updates valid fields', async () => {
    const payload = {
      title: 'Updated task title',
      description: 'New description',
      status: 'in_progress',
      agent: { full_name: 'Creator Person', avatar_url: null },
      assignee: { full_name: 'Assignee Person', avatar_url: null },
    };

    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(200);

    expect(mockUpdate).toHaveBeenCalledWith({
      title: 'Updated task title',
      description: 'New description',
      status: 'in_progress',
    });
  });

  it('rejects attempts to update protected field account_id with 400', async () => {
    const payload = {
      title: 'Legit title',
      account_id: 'malicious-account-uuid',
    };

    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Cannot modify protected field: account_id');
  });

  it('rejects unknown fields with 400', async () => {
    const payload = {
      title: 'Legit title',
      unknown_custom_column: 'bad value',
    };

    const req = new Request('http://localhost/api/action-items/task-123', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'task-123' }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Unknown field: unknown_custom_column');
  });
});
