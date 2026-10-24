import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request) {
  return handleReaper(request)
}

export async function POST(request: Request) {
  return handleReaper(request)
}

async function handleReaper(request: Request) {
  const cronSecret = process.env.CRON_SECRET

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
    }

    const authHeader = request.headers.get('authorization') ?? ''
    const expected = `Bearer ${cronSecret}`
    const suppliedBuf = Buffer.from(authHeader)
    const expectedBuf = Buffer.from(expected)

    if (
      suppliedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(suppliedBuf, expectedBuf)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else if (cronSecret) {
    const authHeader = request.headers.get('authorization') ?? ''
    const expected = `Bearer ${cronSecret}`
    const suppliedBuf = Buffer.from(authHeader)
    const expectedBuf = Buffer.from(expected)

    if (
      suppliedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(suppliedBuf, expectedBuf)
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    // Find all sending broadcasts missing heartbeat for 15+ minutes
    const { data: stuckBroadcasts, error } = await supabaseAdmin()
      .from('broadcasts')
      .select('id, name, created_at')
      .eq('status', 'sending')
      .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`)

    if (error) {
      console.error('[broadcast-reaper] Query error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!stuckBroadcasts || stuckBroadcasts.length === 0) {
      return NextResponse.json({ success: true, interruptedCount: 0 })
    }

    const stuckIds = stuckBroadcasts.map((b) => b.id)

    // Mark broadcasts as interrupted
    await supabaseAdmin()
      .from('broadcasts')
      .update({
        status: 'interrupted',
        halted_reason: 'Sending process lost heartbeat (no update for 15+ minutes)',
        heartbeat_at: new Date().toISOString(),
      })
      .in('id', stuckIds)

    // Ensure unsent recipient rows remain queued for resume
    await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'queued' })
      .in('broadcast_id', stuckIds)
      .in('status', ['pending', 'sending', 'retrying'])

    console.log(`[broadcast-reaper] Interrupted ${stuckIds.length} stuck broadcasts`)

    return NextResponse.json({
      success: true,
      interruptedCount: stuckIds.length,
      stuckIds,
    })
  } catch (err: any) {
    console.error('[broadcast-reaper] Error:', err)
    return NextResponse.json({ error: err.message || 'Reaper failed' }, { status: 500 })
  }
}
