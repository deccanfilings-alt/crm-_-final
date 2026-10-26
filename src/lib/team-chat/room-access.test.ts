import { describe, it, expect, vi } from 'vitest'
import { canViewRoom } from './room-access'

describe('canViewRoom', () => {
  it('returns true when RPC returns true', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    } as any

    const result = await canViewRoom(mockSupabase, 'room-123')
    expect(result).toBe(true)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('can_view_team_room', {
      p_room_id: 'room-123',
    })
  })

  it('returns false when RPC returns false', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    } as any

    const result = await canViewRoom(mockSupabase, 'room-123')
    expect(result).toBe(false)
  })

  it('returns false when RPC returns an error', async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: new Error('Permission denied') }),
    } as any

    const result = await canViewRoom(mockSupabase, 'room-123')
    expect(result).toBe(false)
  })
})
