import { describe, it, expect } from 'vitest'
import { buildMentionRegex, buildNotificationRows } from './mentions'

describe('Team Chat Mentions', () => {
  const memberNames: Record<string, string> = {
    'user-1': 'Ravi Kumar',
    'user-2': 'Priya Sharma',
    'user-3': 'Ravi',
  }

  describe('buildMentionRegex', () => {
    it('matches full name for @Ravi Kumar rather than just first name', () => {
      const regex = buildMentionRegex(memberNames, ['user-1', 'user-3'])
      const text = 'Hey @Ravi Kumar, can you check this?'
      const matches = text.match(regex)
      expect(matches).toEqual(['@Ravi Kumar'])
    })

    it('does not highlight emails', () => {
      const regex = buildMentionRegex(memberNames, ['user-1'])
      const text = 'Send an email to ravi@example.com for info'
      const matches = text.match(regex)
      expect(matches).toBeNull()
    })

    it('does not match plain @ tokens like @ 5pm', () => {
      const regex = buildMentionRegex(memberNames, ['user-1'])
      const text = 'Meeting is at @ 5pm'
      const matches = text.match(regex)
      expect(matches).toBeNull()
    })

    it('matches broadcast mentions @channel, @everyone, @here', () => {
      const regex = buildMentionRegex(memberNames, [])
      const text = 'Attention @channel and @here!'
      const matches = text.match(regex)
      expect(matches).toEqual(['@channel', '@here'])
    })

    it('matches contact tokens correctly', () => {
      const regex = buildMentionRegex(memberNames, [])
      const text = 'Check with @{contact:12345:Acme Corp}'
      const matches = text.match(regex)
      expect(matches).toEqual(['@{contact:12345:Acme Corp}'])
    })
  })

  describe('buildNotificationRows', () => {
    const defaultParams = {
      accountId: 'acc-1',
      senderId: 'sender-1',
      senderName: 'Suresh',
      roomId: 'room-1',
      roomName: 'accounting',
      content: 'Hello @Ravi Kumar please review',
      messageId: 'msg-1',
    }

    it('creates notification rows for direct mentions excluding sender', () => {
      const rows = buildNotificationRows({
        ...defaultParams,
        mentionedUserIds: ['user-1', 'sender-1'],
      })

      expect(rows).toHaveLength(1)
      expect(rows[0].user_id).toBe('user-1')
      expect(rows[0].title).toBe('Suresh mentioned you in #accounting')
      expect(rows[0].type).toBe('team_mention')
      expect(rows[0].link).toBe('/team-chat?room=room-1&m=msg-1')
      expect(rows[0].metadata).toEqual({ room_id: 'room-1', message_id: 'msg-1' })
    })

    it('creates notification rows for broadcast mentions', () => {
      const rows = buildNotificationRows({
        ...defaultParams,
        content: '@channel important announcement',
        mentionedUserIds: ['user-1', 'user-2'],
      })

      expect(rows).toHaveLength(2)
      expect(rows[0].title).toBe('📢 Suresh in #accounting')
      expect(rows[1].title).toBe('📢 Suresh in #accounting')
    })

    it('creates notification row for direct message partner', () => {
      const rows = buildNotificationRows({
        ...defaultParams,
        isDirect: true,
        dmUserIds: ['sender-1', 'user-2'],
        content: 'Hey Priya, are you free?',
      })

      expect(rows).toHaveLength(1)
      expect(rows[0].user_id).toBe('user-2')
      expect(rows[0].title).toBe('Suresh sent you a message')
      expect(rows[0].type).toBe('team_message')
    })

    it('replaces contact tokens in notification body with clean contact name', () => {
      const rows = buildNotificationRows({
        ...defaultParams,
        content: 'Check @{contact:999:Tata Steel} quotation',
        mentionedUserIds: ['user-1'],
      })

      expect(rows[0].body).toBe('Check @Tata Steel quotation')
    })
  })
})
