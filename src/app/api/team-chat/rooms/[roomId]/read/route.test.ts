import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

const { mockUser, mockUpsert, mockUpdate } = vi.hoisted(() => ({
  mockUser: { id: 'test-user-123' },
  mockUpsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  mockUpdate: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        contains: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    }),
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  }),
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn().mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'team_room_reads') {
        return { upsert: mockUpsert }
      }
      if (table === 'notifications') {
        return { update: mockUpdate }
      }
      return {}
    }),
  }),
}))

vi.mock('@/lib/team-chat/room-access', () => ({
  canViewRoom: vi.fn().mockResolvedValue(true),
}))

describe('POST /api/team-chat/rooms/[roomId]/read', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks room read and marks matching notifications as read', async () => {
    const response = await POST(new Request('http://localhost/api/team-chat/rooms/room-123/read', { method: 'POST' }), {
      params: Promise.resolve({ roomId: 'room-123' }),
    })

    expect(response.status).toBe(204)
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        room_id: 'room-123',
        user_id: 'test-user-123',
      }),
      { onConflict: 'room_id,user_id' }
    )
    expect(mockUpdate).toHaveBeenCalledWith({ read: true })
  })
})
