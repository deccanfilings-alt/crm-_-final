import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { canViewRoom } from '@/lib/team-chat/room-access'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const hasAccess = await canViewRoom(supabase, roomId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    const now = new Date().toISOString()
    // Upsert read state
    await supabaseAdmin()
      .from('team_room_reads')
      .upsert(
        {
          room_id: roomId,
          user_id: user.id,
          last_read_at: now,
        },
        { onConflict: 'room_id,user_id' }
      )

    // Mark room notifications read
    await supabaseAdmin()
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)
      .contains('metadata', { room_id: roomId })

    return new Response(null, { status: 204 })
  } catch (err: any) {
    console.error('[team-chat] Failed to mark room read:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
