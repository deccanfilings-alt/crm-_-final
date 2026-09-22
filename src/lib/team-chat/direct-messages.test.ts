import { describe, it, expect } from 'vitest'
import {
  getCanonicalDmRoomName,
  canDeleteMessage,
  getDmPartnerId,
  formatRoomTitle,
} from './dm-utils'

describe('Team Chat Direct Messaging Utilities', () => {
  const userA = '11111111-1111-1111-1111-111111111111'
  const userB = '22222222-2222-2222-2222-222222222222'

  describe('getCanonicalDmRoomName', () => {
    it('produces identical deterministic room names regardless of argument order', () => {
      const room1 = getCanonicalDmRoomName(userA, userB)
      const room2 = getCanonicalDmRoomName(userB, userA)
      expect(room1).toBe(room2)
      expect(room1).toBe(`dm:${userA}:${userB}`)
    })

    it('throws when attempting to create a DM with oneself', () => {
      expect(() => getCanonicalDmRoomName(userA, userA)).toThrow(
        'Cannot start a direct message with yourself'
      )
    })

    it('throws when user IDs are missing', () => {
      expect(() => getCanonicalDmRoomName('', userB)).toThrow()
      expect(() => getCanonicalDmRoomName(userA, '')).toThrow()
    })
  })

  describe('canDeleteMessage', () => {
    it('allows author to delete their own message regardless of role', () => {
      expect(canDeleteMessage(userA, userA, 'agent')).toBe(true)
      expect(canDeleteMessage(userA, userA, 'admin')).toBe(true)
      expect(canDeleteMessage(userA, userA, 'owner')).toBe(true)
      expect(canDeleteMessage(userA, userA, null)).toBe(true)
    })

    it('allows owner or admin to delete another user message for moderation', () => {
      expect(canDeleteMessage(userA, userB, 'owner')).toBe(true)
      expect(canDeleteMessage(userA, userB, 'admin')).toBe(true)
    })

    it('denies another standard agent from deleting someone elses message', () => {
      expect(canDeleteMessage(userA, userB, 'agent')).toBe(false)
      expect(canDeleteMessage(userA, userB, null)).toBe(false)
      expect(canDeleteMessage(userA, userB, undefined)).toBe(false)
    })

    it('returns false when IDs are missing', () => {
      expect(canDeleteMessage(undefined, userB, 'owner')).toBe(false)
      expect(canDeleteMessage(userA, undefined, 'owner')).toBe(false)
    })
  })

  describe('getDmPartnerId', () => {
    it('extracts the counterpart user ID from participant array', () => {
      expect(getDmPartnerId([userA, userB], userA)).toBe(userB)
      expect(getDmPartnerId([userA, userB], userB)).toBe(userA)
    })

    it('returns null if array is empty or undefined', () => {
      expect(getDmPartnerId([], userA)).toBeNull()
      expect(getDmPartnerId(undefined, userA)).toBeNull()
    })
  })

  describe('formatRoomTitle', () => {
    it('formats public channel names with leading hash', () => {
      expect(formatRoomTitle({ name: 'general', is_direct: false })).toBe('#general')
      expect(formatRoomTitle({ name: '#sales', is_direct: false })).toBe('#sales')
    })

    it('formats direct message rooms with partner full name', () => {
      expect(
        formatRoomTitle({
          name: 'dm:1:2',
          is_direct: true,
          dm_partner: { full_name: 'Sarah Connor' },
        })
      ).toBe('Sarah Connor')
    })

    it('falls back gracefully if partner name is missing', () => {
      expect(
        formatRoomTitle({
          name: 'dm:1:2',
          is_direct: true,
          dm_partner: { full_name: null },
        })
      ).toBe('Teammate')
    })
  })
})
