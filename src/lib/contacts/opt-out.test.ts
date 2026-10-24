import { describe, it, expect } from 'vitest'
import { parseOptKeyword, findContactIdForWamid, setMarketingOptOut } from './opt-out'

describe('parseOptKeyword', () => {
  it('parses stop keywords to "out"', () => {
    expect(parseOptKeyword('STOP')).toBe('out')
    expect(parseOptKeyword('stop.')).toBe('out')
    expect(parseOptKeyword(' Unsubscribe ')).toBe('out')
    expect(parseOptKeyword('Stop promotions')).toBe('out')
    expect(parseOptKeyword('stop all!')).toBe('out')
    expect(parseOptKeyword('opt out')).toBe('out')
  })

  it('parses start keywords to "in"', () => {
    expect(parseOptKeyword('start')).toBe('in')
    expect(parseOptKeyword('subscribe')).toBe('in')
    expect(parseOptKeyword('opt in')).toBe('in')
    expect(parseOptKeyword('START!')).toBe('in')
  })

  it('returns null for non-matching phrases and invalid inputs', () => {
    expect(parseOptKeyword('please stop calling')).toBeNull()
    expect(parseOptKeyword('stop it right now')).toBeNull()
    expect(parseOptKeyword('hello')).toBeNull()
    expect(parseOptKeyword('')).toBeNull()
    expect(parseOptKeyword('   ')).toBeNull()
    expect(parseOptKeyword(null)).toBeNull()
    expect(parseOptKeyword(undefined)).toBeNull()
  })
})

describe('findContactIdForWamid', () => {
  it('finds contact id via messages table', async () => {
    const mockDb: any = {
      from: (table: string) => {
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    conversation: { contact_id: 'contact-msg-1' },
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      },
    }

    const contactId = await findContactIdForWamid(mockDb, 'wamid.123')
    expect(contactId).toBe('contact-msg-1')
  })

  it('falls back to broadcast_recipients table if not found in messages', async () => {
    const mockDb: any = {
      from: (table: string) => {
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }
        }
        if (table === 'broadcast_recipients') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { contact_id: 'contact-broadcast-2' },
                  error: null,
                }),
              }),
            }),
          }
        }
        return {}
      },
    }

    const contactId = await findContactIdForWamid(mockDb, 'wamid.456')
    expect(contactId).toBe('contact-broadcast-2')
  })

  it('returns null if found in neither', async () => {
    const mockDb: any = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    }

    const contactId = await findContactIdForWamid(mockDb, 'wamid.unknown')
    expect(contactId).toBeNull()
  })
})

describe('setMarketingOptOut', () => {
  it('updates contacts table with opted_out_marketing', async () => {
    let updatedPayload: any = null
    let targetId: any = null

    const mockDb: any = {
      from: (table: string) => {
        expect(table).toBe('contacts')
        return {
          update: (payload: any) => {
            updatedPayload = payload
            return {
              eq: (col: string, val: any) => {
                expect(col).toBe('id')
                targetId = val
                return { error: null }
              },
            }
          },
        }
      },
    }

    await setMarketingOptOut(mockDb, 'contact-999', true)
    expect(targetId).toBe('contact-999')
    expect(updatedPayload.opted_out_marketing).toBe(true)
    expect(updatedPayload.updated_at).toBeDefined()
  })
})
