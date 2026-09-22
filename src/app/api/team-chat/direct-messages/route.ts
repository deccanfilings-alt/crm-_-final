import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { getCanonicalDmRoomName } from '@/lib/team-chat/dm-utils'

/**
 * POST /api/team-chat/direct-messages
 * Initiates or returns an existing 1-on-1 direct message conversation with a colleague.
 * Body: { target_user_id: string }
 */
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
      .select('account_id, full_name, avatar_url, account_role')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const { target_user_id } = body

    if (!target_user_id || typeof target_user_id !== 'string') {
      return NextResponse.json({ error: 'Target teammate ID is required' }, { status: 400 })
    }

    if (target_user_id === user.id) {
      return NextResponse.json(
        { error: 'Cannot start a direct message with yourself' },
        { status: 400 }
      )
    }

    // Verify target teammate exists in the same account
    const { data: targetProfile, error: targetErr } = await supabaseAdmin()
      .from('profiles')
      .select('user_id, full_name, avatar_url, account_role, agent_status, email')
      .eq('user_id', target_user_id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (targetErr || !targetProfile) {
      return NextResponse.json({ error: 'Teammate not found in this organization' }, { status: 404 })
    }

    // Calculate deterministic canonical room name
    const sortedUserIds = [user.id, target_user_id].sort()
    const dmRoomName = getCanonicalDmRoomName(user.id, target_user_id)

    // Check if DM room already exists
    const { data: existingRoom } = await supabaseAdmin()
      .from('team_rooms')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', dmRoomName)
      .maybeSingle()

    if (existingRoom) {
      // Room already exists, return with partner profile
      return NextResponse.json({
        success: true,
        room: {
          ...existingRoom,
          is_direct: true,
          dm_user_ids: sortedUserIds,
          dm_partner: targetProfile,
        },
        created: false,
      })
    }

    // Room does not exist yet: create it
    const { data: newRoom, error: insertError } = await supabaseAdmin()
      .from('team_rooms')
      .insert({
        account_id: accountId,
        name: dmRoomName,
        description: `Direct message between ${profile?.full_name || 'Teammate'} and ${targetProfile.full_name || 'Teammate'}`,
        created_by: user.id,
        is_direct: true,
        dm_user_ids: sortedUserIds,
      })
      .select()
      .single()

    if (insertError || !newRoom) {
      console.error('[team-chat] Failed to create DM room:', insertError)
      return NextResponse.json({ error: 'Failed to initiate direct message' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      room: {
        ...newRoom,
        is_direct: true,
        dm_user_ids: sortedUserIds,
        dm_partner: targetProfile,
      },
      created: true,
    })
  } catch (error) {
    console.error('[team-chat] POST direct-message unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/team-chat/direct-messages
 * Lists all direct message rooms for the authenticated user with partner profile info.
 */
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
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    // Fetch all DM rooms involving this user
    const { data: rooms, error: roomsErr } = await supabaseAdmin()
      .from('team_rooms')
      .select('*')
      .eq('account_id', accountId)
      .eq('is_direct', true)
      .contains('dm_user_ids', [user.id])
      .order('updated_at', { ascending: false })

    if (roomsErr) {
      console.error('[team-chat] Failed to fetch DM rooms:', roomsErr)
      return NextResponse.json({ error: 'Failed to fetch direct messages' }, { status: 500 })
    }

    const dmRooms = rooms || []

    // Collect all partner user IDs
    const partnerIds = Array.from(
      new Set(
        dmRooms
          .flatMap((r: any) => r.dm_user_ids || [])
          .filter((uid: string) => uid && uid !== user.id)
      )
    )

    // Fetch partner profiles
    const { data: partners } = partnerIds.length > 0
      ? await supabaseAdmin()
          .from('profiles')
          .select('user_id, full_name, avatar_url, account_role, agent_status, email')
          .in('user_id', partnerIds)
      : { data: [] }

    const partnerMap = new Map((partners || []).map((p: any) => [p.user_id, p]))

    // Fetch last message for each DM room
    const enrichedDmRooms = await Promise.all(
      dmRooms.map(async (room: any) => {
        const partnerId = (room.dm_user_ids || []).find((uid: string) => uid !== user.id)
        const partner = partnerMap.get(partnerId) || null

        const { data: lastMsg } = await supabaseAdmin()
          .from('team_messages')
          .select('content, created_at, sender_id')
          .eq('room_id', room.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        return {
          ...room,
          is_direct: true,
          dm_partner: partner,
          last_message: lastMsg || null,
        }
      })
    )

    return NextResponse.json({ directMessages: enrichedDmRooms })
  } catch (error) {
    console.error('[team-chat] GET direct-messages unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
