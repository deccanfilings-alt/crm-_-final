import { describe, it, expect, vi } from 'vitest'
import { notifyHandoff } from './handoff-notify'

describe('notifyHandoff', () => {
  it('creates one notification row for an explicitly assigned agent', async () => {
    const insertedRows: any[] = []

    const mockDb: any = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    account_id: 'acc-123',
                    contact_id: 'contact-456',
                    assigned_agent_id: null,
                    contact: { name: 'Alice Smith', phone: '919876543210' },
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'notifications') {
          return {
            insert: async (rows: any[]) => {
              insertedRows.push(...rows)
              return { error: null }
            },
          }
        }
        return {}
      },
    }

    const count = await notifyHandoff(mockDb, {
      conversationId: 'conv-1',
      assignedTo: 'agent-bob',
      note: 'Customer wants a quote',
      reason: 'handoff_node',
    })

    expect(count).toBe(1)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toEqual({
      account_id: 'acc-123',
      user_id: 'agent-bob',
      type: 'conversation_assigned',
      title: 'Needs a person: Alice Smith',
      body: 'Customer wants a quote',
      link: '/inbox?c=conv-1',
      read: false,
      metadata: {
        conversation_id: 'conv-1',
        reason: 'handoff_node',
      },
    })
  })

  it('creates notifications for all owners and admins when unassigned', async () => {
    const insertedRows: any[] = []

    const mockDb: any = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    account_id: 'acc-123',
                    contact_id: 'contact-456',
                    assigned_agent_id: null,
                    contact: { name: null, phone: '919876543210' },
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: [
                    { user_id: 'user-owner' },
                    { user_id: 'user-admin' },
                  ],
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'notifications') {
          return {
            insert: async (rows: any[]) => {
              insertedRows.push(...rows)
              return { error: null }
            },
          }
        }
        return {}
      },
    }

    const count = await notifyHandoff(mockDb, {
      conversationId: 'conv-2',
      reason: 'fallback_exhausted',
    })

    expect(count).toBe(2)
    expect(insertedRows).toHaveLength(2)
    expect(insertedRows.map((r) => r.user_id)).toEqual(['user-owner', 'user-admin'])
    expect(insertedRows[0].title).toBe('Needs a person: 919876543210')
    expect(insertedRows[0].body).toBe('The assistant handed this conversation to the team.')
    expect(insertedRows[0].metadata.reason).toBe('fallback_exhausted')
  })

  it('resolves to 0 and does not throw when insert fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const mockDb: any = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    account_id: 'acc-123',
                    contact_id: 'contact-456',
                    assigned_agent_id: 'agent-1',
                    contact: null,
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'notifications') {
          return {
            insert: async () => ({
              error: { message: 'Database connection failed' },
            }),
          }
        }
        return {}
      },
    }

    const count = await notifyHandoff(mockDb, {
      conversationId: 'conv-3',
      reason: 'handoff_node',
    })

    expect(count).toBe(0)
    consoleSpy.mockRestore()
  })
})
