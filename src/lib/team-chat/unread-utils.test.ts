import { describe, it, expect } from 'vitest'
import { findFirstUnreadIndex } from './unread-utils'

describe('findFirstUnreadIndex', () => {
  const myId = 'user-me'
  const otherId = 'user-other'

  const messages = [
    { id: '1', created_at: '2026-10-26T10:00:00Z', sender_id: otherId },
    { id: '2', created_at: '2026-10-26T10:05:00Z', sender_id: myId },
    { id: '3', created_at: '2026-10-26T10:10:00Z', sender_id: otherId },
    { id: '4', created_at: '2026-10-26T10:15:00Z', sender_id: otherId },
  ]

  it('returns -1 if lastReadAt is null or undefined', () => {
    expect(findFirstUnreadIndex(messages, null, myId)).toBe(-1)
    expect(findFirstUnreadIndex(messages, undefined, myId)).toBe(-1)
  })

  it('finds the index of the first message sent by someone else after lastReadAt', () => {
    // Read at 10:06: message 3 at 10:10 is first unread
    const index = findFirstUnreadIndex(messages, '2026-10-26T10:06:00Z', myId)
    expect(index).toBe(2)
  })

  it('ignores messages sent by myself after lastReadAt', () => {
    // Read at 10:02: message 2 is mine (10:05), message 3 is other (10:10)
    // Wait, let's see if message 2 is skipped: yes, sender_id === myId is ignored
    const index = findFirstUnreadIndex(messages, '2026-10-26T10:02:00Z', myId)
    expect(index).toBe(2)
  })

  it('returns -1 if all messages were read', () => {
    const index = findFirstUnreadIndex(messages, '2026-10-26T10:20:00Z', myId)
    expect(index).toBe(-1)
  })
})
