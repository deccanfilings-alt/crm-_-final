import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET() {
  try {
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
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    // Fetch existing rooms
    let { data: rooms, error: roomsError } = await supabaseAdmin()
      .from('team_rooms')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })

    if (roomsError) {
      console.error('[team-chat] Error fetching rooms:', roomsError)
      return NextResponse.json({ error: 'Failed to fetch rooms' }, { status: 500 })
    }

    // Auto-seed default #general room if no rooms exist yet
    if (!rooms || rooms.length === 0) {
      const { data: newRoom, error: seedError } = await supabaseAdmin()
        .from('team_rooms')
        .insert({
          account_id: accountId,
          name: 'general',
          description: 'Company-wide general discussions and announcements',
          created_by: user.id,
        })
        .select()
        .single()

      if (!seedError && newRoom) {
        rooms = [newRoom]
      }
    }

    // Fetch latest message for each room to display preview
    const roomIds = (rooms || []).map((r: { id: string }) => r.id)
    const roomsWithLastMessage = await Promise.all(
      (rooms || []).map(async (room: any) => {
        const { data: lastMsg } = await supabaseAdmin()
          .from('team_messages')
          .select('content, created_at, sender_id')
          .eq('room_id', room.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        let senderName: string | undefined
        if (lastMsg?.sender_id) {
          const { data: senderProf } = await supabaseAdmin()
            .from('profiles')
            .select('full_name')
            .eq('user_id', lastMsg.sender_id)
            .maybeSingle()
          senderName = senderProf?.full_name || undefined
        }

        return {
          ...room,
          last_message: lastMsg
            ? {
                content: lastMsg.content,
                sender_name: senderName,
                created_at: lastMsg.created_at,
              }
            : null,
        }
      })
    )

    return NextResponse.json({
      rooms: roomsWithLastMessage,
      userRole: profile?.account_role || 'agent',
    })
  } catch (error) {
    console.error('[team-chat] GET rooms unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
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
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    const accountRole = profile?.account_role as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    // STRICT OWNER/ADMIN GATE: Only owner and admin can create rooms
    if (accountRole !== 'owner' && accountRole !== 'admin') {
      return NextResponse.json(
        { error: 'Only Account Owners and Team Leaders can create chat rooms.' },
        { status: 403 }
      )
    }

    const body = await request.json()
    let { name, description } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Room name is required' }, { status: 400 })
    }

    // Format room name: remove leading #, lowercase, replace spaces with hyphens, allow alphanumeric and hyphens
    name = name.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-')
    if (!name) {
      return NextResponse.json({ error: 'Valid room name is required' }, { status: 400 })
    }

    // Check if room name already exists in account
    const { data: existing } = await supabaseAdmin()
      .from('team_rooms')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', name)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: `A room named #${name} already exists.` },
        { status: 409 }
      )
    }

    const { data: room, error: insertError } = await supabaseAdmin()
      .from('team_rooms')
      .insert({
        account_id: accountId,
        name,
        description: description?.trim() || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertError || !room) {
      console.error('[team-chat] Room creation failed:', insertError)
      return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
    }

    return NextResponse.json({ success: true, room })
  } catch (error) {
    console.error('[team-chat] POST room unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
