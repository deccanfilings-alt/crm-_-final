import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { processBroadcast } from '@/lib/whatsapp/broadcast-engine'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: broadcastId } = await params
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    // Verify broadcast belongs to account
    const { data: broadcast } = await supabaseAdmin()
      .from('broadcasts')
      .select('id, status')
      .eq('id', broadcastId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!broadcast) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
    }

    // Reset failed/deferred rows that had disposition 'retry' or 'defer' back to queued
    const { data: resetRows, error: resetErr } = await supabaseAdmin()
      .from('broadcast_recipients')
      .update({
        status: 'queued',
        attempt_count: 0,
        error_message: null,
        error_code: null,
        error_details: null,
      })
      .eq('broadcast_id', broadcastId)
      .in('disposition', ['retry', 'defer'])
      .not('status', 'in', '("sent","delivered","read","quarantined")')
      .select('id')

    if (resetErr) {
      console.error('[broadcast/retry-failed] Reset error:', resetErr)
    }

    // Trigger processBroadcast in retry-only mode
    const result = await processBroadcast(supabaseAdmin(), broadcastId, { isRetryOnly: true })

    return NextResponse.json({
      success: true,
      message: 'Retry-failed run completed',
      resetCount: resetRows ? resetRows.length : 0,
      result,
    })
  } catch (error: any) {
    console.error('[broadcast/retry-failed] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to retry broadcast' },
      { status: 500 }
    )
  }
}
