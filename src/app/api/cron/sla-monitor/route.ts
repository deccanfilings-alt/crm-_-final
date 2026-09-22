import { NextResponse } from 'next/server'
import { checkAndTriggerSlaBreaches } from '@/lib/automations/sla-monitor'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    // Allow cron invocation via secret or authenticated user
    let isAuthorized = false

    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      isAuthorized = true
    } else {
      const supabase = await createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        isAuthorized = true
      }
    }

    if (!isAuthorized && process.env.NODE_ENV === 'production' && cronSecret) {
      return NextResponse.json({ error: 'Unauthorized cron request' }, { status: 401 })
    }

    const url = new URL(request.url)
    const accountId = url.searchParams.get('accountId') || undefined

    const stats = await checkAndTriggerSlaBreaches(accountId)

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats,
    })
  } catch (error) {
    console.error('[cron/sla-monitor] Execution error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
