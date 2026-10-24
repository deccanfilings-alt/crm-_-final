import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET as reaperGet } from './broadcast-reaper/route'
import { GET as slaGet } from './sla-monitor/route'

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          or: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    })),
  })),
}))

vi.mock('@/lib/automations/sla-monitor', () => ({
  checkAndTriggerSlaBreaches: vi.fn().mockResolvedValue({ checked: 0, breached: 0 }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  }),
}))

describe('Task 8: Cron Hardening', () => {
  const origEnv = process.env

  beforeEach(() => {
    process.env = { ...origEnv }
  })

  afterEach(() => {
    process.env = origEnv
  })

  describe('broadcast-reaper', () => {
    it('returns 503 in production when CRON_SECRET is unset', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.CRON_SECRET

      const req = new Request('http://localhost/api/cron/broadcast-reaper')
      const res = await reaperGet(req)
      expect(res.status).toBe(503)
      const data = await res.json()
      expect(data).toEqual({ error: 'cron not configured' })
    })

    it('returns 401 in production when secret does not match', async () => {
      process.env.NODE_ENV = 'production'
      process.env.CRON_SECRET = 'correct-secret'

      const req = new Request('http://localhost/api/cron/broadcast-reaper', {
        headers: { authorization: 'Bearer wrong-secret' },
      })
      const res = await reaperGet(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toEqual({ error: 'Unauthorized' })
    })

    it('allows execution when secret matches', async () => {
      process.env.NODE_ENV = 'production'
      process.env.CRON_SECRET = 'correct-secret'

      const req = new Request('http://localhost/api/cron/broadcast-reaper', {
        headers: { authorization: 'Bearer correct-secret' },
      })
      const res = await reaperGet(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })

  describe('sla-monitor', () => {
    it('returns 503 in production when CRON_SECRET is unset and no session', async () => {
      process.env.NODE_ENV = 'production'
      delete process.env.CRON_SECRET

      const req = new Request('http://localhost/api/cron/sla-monitor')
      const res = await slaGet(req)
      expect(res.status).toBe(503)
      const data = await res.json()
      expect(data).toEqual({ error: 'cron not configured' })
    })

    it('returns 401 in production when secret is set but invalid and no session', async () => {
      process.env.NODE_ENV = 'production'
      process.env.CRON_SECRET = 'correct-secret'

      const req = new Request('http://localhost/api/cron/sla-monitor', {
        headers: { authorization: 'Bearer wrong-secret' },
      })
      const res = await slaGet(req)
      expect(res.status).toBe(401)
      const data = await res.json()
      expect(data).toEqual({ error: 'Unauthorized cron request' })
    })

    it('allows execution when secret matches', async () => {
      process.env.NODE_ENV = 'production'
      process.env.CRON_SECRET = 'correct-secret'

      const req = new Request('http://localhost/api/cron/sla-monitor', {
        headers: { authorization: 'Bearer correct-secret' },
      })
      const res = await slaGet(req)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })
})
