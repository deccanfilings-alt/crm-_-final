import { describe, it, expect, vi } from 'vitest'
import { recordBroadcastInThread } from './broadcast-thread'

describe('recordBroadcastInThread', () => {
  it('creates a closed conversation with last_message_at when none exists and inserts message', async () => {
    let insertedConv: any = null
    let insertedMsg: any = null

    const mockDb: any = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: async () => ({ data: [], error: null }),
                  }),
                }),
              }),
            }),
            insert: (data: any) => {
              insertedConv = data
              return {
                select: () => ({
                  single: async () => ({ data: { id: 'new-conv-123' }, error: null }),
                }),
              }
            },
          }
        }
        if (table === 'messages') {
          return {
            insert: async (data: any) => {
              insertedMsg = data
              return { error: null }
            },
          }
        }
        return {}
      },
    }

    await recordBroadcastInThread(mockDb, {
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      contactId: 'contact-1',
      wamid: 'wamid.100',
      templateName: 'welcome_offer',
      bodyText: 'Hello {{1}}, here is {{2}}% off!',
      params: ['Alice', '20'],
    })

    expect(insertedConv).toBeDefined()
    expect(insertedConv.status).toBe('closed')
    expect(insertedConv.last_message_at).toBeDefined()
    expect(insertedConv.last_message_text).toBe('Hello Alice, here is 20% off!')
    expect(insertedConv.channel).toBe('whatsapp')

    expect(insertedMsg).toBeDefined()
    expect(insertedMsg.conversation_id).toBe('new-conv-123')
    expect(insertedMsg.sender_type).toBe('bot')
    expect(insertedMsg.content_type).toBe('template')
    expect(insertedMsg.content_text).toBe('Hello Alice, here is 20% off!')
    expect(insertedMsg.template_name).toBe('welcome_offer')
    expect(insertedMsg.message_id).toBe('wamid.100')
    expect(insertedMsg.status).toBe('sent')
  })

  it('renders fallback [Template: name] when bodyText is missing', async () => {
    let insertedMsg: any = null

    const mockDb: any = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: async () => ({ data: [{ id: 'existing-conv-1' }], error: null }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'messages') {
          return {
            insert: async (data: any) => {
              insertedMsg = data
              return { error: null }
            },
          }
        }
        return {}
      },
    }

    await recordBroadcastInThread(mockDb, {
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      contactId: 'contact-1',
      wamid: 'wamid.101',
      templateName: 'utility_notice',
      bodyText: null,
      params: [],
    })

    expect(insertedMsg.content_text).toBe('[Template: utility_notice]')
  })

  it('reuses existing conversation and never touches its last_message_at', async () => {
    let conversationUpdated = false

    const mockDb: any = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: async () => ({ data: [{ id: 'existing-conv-2' }], error: null }),
                  }),
                }),
              }),
            }),
            update: () => {
              conversationUpdated = true
              return { eq: () => ({}) }
            },
          }
        }
        if (table === 'messages') {
          return {
            insert: async () => ({ error: null }),
          }
        }
        return {}
      },
    }

    await recordBroadcastInThread(mockDb, {
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      contactId: 'contact-1',
      wamid: 'wamid.102',
      templateName: 'promo',
      bodyText: 'Hi',
      params: [],
    })

    expect(conversationUpdated).toBe(false)
  })

  it('re-selects conversation if insert encounters unique violation', async () => {
    let selectCount = 0
    let insertedMsg: any = null

    const mockDb: any = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    limit: async () => {
                      selectCount++
                      if (selectCount === 1) return { data: [], error: null }
                      return { data: [{ id: 'winner-conv-id' }], error: null }
                    },
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                }),
              }),
            }),
          }
        }
        if (table === 'messages') {
          return {
            insert: async (data: any) => {
              insertedMsg = data
              return { error: null }
            },
          }
        }
        return {}
      },
    }

    await recordBroadcastInThread(mockDb, {
      accountId: 'acc-1',
      ownerUserId: 'user-1',
      contactId: 'contact-1',
      wamid: 'wamid.103',
      templateName: 'promo',
      bodyText: 'Hi',
      params: [],
    })

    expect(selectCount).toBe(2)
    expect(insertedMsg.conversation_id).toBe('winner-conv-id')
  })

  it('swallows db error and does not throw', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mockDb: any = {
      from: () => {
        throw new Error('Database down')
      },
    }

    await expect(
      recordBroadcastInThread(mockDb, {
        accountId: 'acc-1',
        ownerUserId: 'user-1',
        contactId: 'contact-1',
        wamid: 'wamid.104',
        templateName: 'promo',
        bodyText: 'Hi',
        params: [],
      })
    ).resolves.toBeUndefined()

    consoleSpy.mockRestore()
  })
})
