import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH } from './route'

const { mockUser, mockRoleRef, mockExistingMessageRef } = vi.hoisted(() => ({
  mockUser: { id: 'user-author-1' },
  mockRoleRef: { role: 'admin' },
  mockExistingMessageRef: {
    message: {
      id: 'msg-1',
      sender_id: 'user-author-1',
      room_id: 'room-1',
      content: 'old text',
    },
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockImplementation(() =>
            Promise.resolve({
              data: { account_id: 'acc-1', account_role: mockRoleRef.role },
              error: null,
            })
          ),
        })),
      })),
    })),
  }),
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn().mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockImplementation(() =>
              Promise.resolve({
                data: mockExistingMessageRef.message,
                error: null,
              })
            ),
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockImplementation(() =>
              Promise.resolve({
                data: {
                  ...mockExistingMessageRef.message,
                  content: 'new text',
                  updated_at: new Date().toISOString(),
                },
                error: null,
              })
            ),
          })),
        })),
      })),
    })),
  }),
}))

vi.mock('@/lib/team-chat/room-access', () => ({
  canViewRoom: vi.fn().mockResolvedValue(true),
}))

describe('PATCH /api/team-chat/rooms/[roomId]/messages - author permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRoleRef.role = 'admin'
    mockExistingMessageRef.message = {
      id: 'msg-1',
      sender_id: 'user-author-1',
      room_id: 'room-1',
      content: 'old text',
    }
  })

  it('an admin PATCH on another person\'s message returns 403 Only the author can edit a message', async () => {
    // Current user is user-author-1 (admin), but message sender is another person
    mockExistingMessageRef.message = {
      id: 'msg-2',
      sender_id: 'different-user-999',
      room_id: 'room-1',
      content: 'someone else\'s message',
    }

    const req = new Request('http://localhost/api/team-chat/rooms/room-1/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'msg-2', content: 'attempted edit by admin' }),
    })

    const res = await PATCH(req, { params: Promise.resolve({ roomId: 'room-1' }) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('Only the author can edit a message.')
  })

  it('author PATCH on their own message works', async () => {
    // Current user is user-author-1 and message sender is user-author-1
    mockExistingMessageRef.message = {
      id: 'msg-1',
      sender_id: 'user-author-1',
      room_id: 'room-1',
      content: 'old text',
    }

    const req = new Request('http://localhost/api/team-chat/rooms/room-1/messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: 'msg-1', content: 'new text' }),
    })

    const res = await PATCH(req, { params: Promise.resolve({ roomId: 'room-1' }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.message.content).toBe('new text')
  })
})
