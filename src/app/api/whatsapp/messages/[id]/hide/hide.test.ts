import { beforeEach, describe, expect, it, vi } from 'vitest'

const ACC = 'acc-1'
const MSG = '11111111-1111-4111-8111-111111111111'

let role: 'owner' | 'admin' | 'agent' | 'viewer' = 'agent'
let row: Record<string, unknown> | null = null
const updates: Record<string, unknown>[] = []

function supabaseMock() {
  return {
    from: () => {
      let pendingUpdate: Record<string, unknown> | null = null
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.update = (p: Record<string, unknown>) => ((pendingUpdate = p), b)
      b.maybeSingle = async () => ({ data: row, error: null })
      b.single = async () => {
        if (pendingUpdate) updates.push(pendingUpdate)
        return { data: { id: MSG, ...pendingUpdate }, error: null }
      }
      return b
    },
  }
}

vi.mock('@/lib/auth/account', async () => {
  const { NextResponse } = await import('next/server')
  return {
    getCurrentAccount: async () => ({
      supabase: supabaseMock(),
      userId: 'user-me',
      accountId: ACC,
      role,
      account: { id: ACC, name: 'Test' },
    }),
    toErrorResponse: () => NextResponse.json({ error: 'Internal server error' }, { status: 500 }),
  }
})

import { POST } from './route'

const call = (body: unknown, id = MSG) =>
  POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })

beforeEach(() => {
  role = 'agent'
  updates.length = 0
  row = { id: MSG, hidden_at: null, hidden_by: null, conversation: { account_id: ACC } }
})

describe('POST /api/whatsapp/messages/:id/hide', () => {
  it('lets an agent hide a message and records who did it', async () => {
    const res = await call({ hidden: true })
    expect(res.status).toBe(200)
    expect(updates[0]).toMatchObject({ hidden_by: 'user-me' })
    expect(updates[0].hidden_at).toBeTruthy()
  })

  it('blocks viewers', async () => {
    role = 'viewer'
    expect((await call({ hidden: true })).status).toBe(403)
    expect(updates).toHaveLength(0)
  })

  it('returns 404 for a message in another account', async () => {
    row = { ...row!, conversation: { account_id: 'someone-else' } }
    expect((await call({ hidden: true })).status).toBe(404)
  })

  it('only lets admins or the person who hid it restore it', async () => {
    row = { ...row!, hidden_at: '2026-11-01T00:00:00Z', hidden_by: 'user-other' }
    expect((await call({ hidden: false })).status).toBe(403)

    role = 'admin'
    const res = await call({ hidden: false })
    expect(res.status).toBe(200)
    expect(updates.at(-1)).toEqual({ hidden_at: null, hidden_by: null })
  })

  it('lets the person who hid it restore it', async () => {
    row = { ...row!, hidden_at: '2026-11-01T00:00:00Z', hidden_by: 'user-me' }
    expect((await call({ hidden: false })).status).toBe(200)
  })

  it('validates input', async () => {
    expect((await call({ hidden: 'yes' })).status).toBe(400)
    expect((await call({ hidden: true }, 'not-a-uuid')).status).toBe(400)
  })
})
