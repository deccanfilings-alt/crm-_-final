import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { canViewRoom } from '@/lib/team-chat/room-access'
import { buildNotificationRows } from '@/lib/team-chat/mentions'

export async function GET(
  request: Request,
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    // Verify room belongs to this account
    const { data: room, error: roomErr } = await supabaseAdmin()
      .from('team_rooms')
      .select('id, account_id, name, description')
      .eq('id', roomId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (roomErr || !room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    const hasAccess = await canViewRoom(supabase, roomId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    // Query params for pagination and live refreshes
    const url = new URL(request.url)
    const limitParam = parseInt(url.searchParams.get('limit') || '50', 10)
    const limit = Math.min(Math.max(isNaN(limitParam) ? 50 : limitParam, 1), 100)
    const before = url.searchParams.get('before')
    const idsParam = url.searchParams.get('ids')

    let messages: any[] = []
    let has_more = false

    if (idsParam) {
      const requestedIds = idsParam
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 20)

      if (requestedIds.length > 0) {
        const { data: idRows, error: idErr } = await supabaseAdmin()
          .from('team_messages')
          .select('*')
          .eq('room_id', roomId)
          .in('id', requestedIds)
          .order('created_at', { ascending: true })

        if (idErr) {
          console.error('[team-chat] Error fetching messages by IDs:', idErr)
          return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
        }
        messages = idRows || []
      }
      has_more = false
    } else {
      let q = supabaseAdmin()
        .from('team_messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: false })
        .limit(limit + 1)

      if (before) {
        q = q.lt('created_at', before)
      }

      const { data: rawRows, error: msgError } = await q
      if (msgError) {
        console.error('[team-chat] Error fetching messages:', msgError)
        return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
      }

      const rows = rawRows || []
      has_more = rows.length > limit
      const pageRows = rows.slice(0, limit)
      messages = pageRows.reverse()
    }

    // Resolve reply quotes that might not be in the current batch
    const msgMap = new Map(messages.map((m: any) => [m.id, m]))
    const missingReplyIds = Array.from(
      new Set(
        messages
          .map((m: any) => m.reply_to_id)
          .filter((rid: string | null) => rid && !msgMap.has(rid))
      )
    )

    const extraSenderIds: string[] = []
    if (missingReplyIds.length > 0) {
      const { data: replyRows } = await supabaseAdmin()
        .from('team_messages')
        .select('*')
        .eq('room_id', roomId)
        .in('id', missingReplyIds)

      for (const rm of replyRows || []) {
        msgMap.set(rm.id, rm)
        if (rm.sender_id) {
          extraSenderIds.push(rm.sender_id)
        }
      }
    }

    // Collect sender IDs (including quoted reply senders) and tagged contact IDs
    const senderIds = Array.from(
      new Set([...messages.map((m: any) => m.sender_id), ...extraSenderIds].filter(Boolean))
    )
    const allTaggedContactIds = Array.from(
      new Set(
        messages
          .flatMap((m: any) => m.tagged_contact_ids || [])
          .filter(Boolean)
      )
    )
    const messageIds = messages.map((m: any) => m.id)

    // Fetch senders' profiles
    const { data: senders } = senderIds.length > 0
      ? await supabaseAdmin()
          .from('profiles')
          .select('user_id, full_name, avatar_url, account_role, email')
          .in('user_id', senderIds)
      : { data: [] }
    const senderMap = new Map((senders || []).map((s: any) => [s.user_id, s]))

    // Fetch tagged contacts with their primary conversation ID (for direct WhatsApp chat links)
    let contactMap = new Map<string, any>()
    if (allTaggedContactIds.length > 0) {
      const { data: contacts } = await supabaseAdmin()
        .from('contacts')
        .select('id, name, phone, email, avatar_url')
        .in('id', allTaggedContactIds)
        .eq('account_id', accountId)

      const { data: convs } = await supabaseAdmin()
        .from('conversations')
        .select('id, contact_id')
        .in('contact_id', allTaggedContactIds)
        .eq('account_id', accountId)

      const convMap = new Map((convs || []).map((c: any) => [c.contact_id, c.id]))

      contactMap = new Map(
        (contacts || []).map((c: any) => [
          c.id,
          {
            id: c.id,
            name: c.name,
            phone: c.phone,
            email: c.email,
            avatar_url: c.avatar_url,
            conversation_id: convMap.get(c.id) || null,
          },
        ])
      )
    }

    // Fetch reactions
    const { data: reactions } = messageIds.length > 0
      ? await supabaseAdmin()
          .from('team_message_reactions')
          .select('*')
          .in('message_id', messageIds)
      : { data: [] }

    const reactionsMap = new Map<string, any[]>()
    for (const r of reactions || []) {
      const list = reactionsMap.get(r.message_id) || []
      list.push(r)
      reactionsMap.set(r.message_id, list)
    }

    // Enrich messages
    const enrichedMessages = messages.map((m: any) => {
      const replyMsg = m.reply_to_id ? msgMap.get(m.reply_to_id) : null
      const replySender = replyMsg ? senderMap.get(replyMsg.sender_id) : null
      const reply_to = replyMsg
        ? {
            id: replyMsg.id,
            content: replyMsg.content,
            sender_name: replySender?.full_name || 'Teammate',
          }
        : null
      const sender = senderMap.get(m.sender_id) || {
        user_id: m.sender_id,
        full_name: 'Team Member',
      }
      const tagged_contacts = (m.tagged_contact_ids || [])
        .map((cid: string) => contactMap.get(cid))
        .filter(Boolean)

      return {
        ...m,
        sender,
        reactions: reactionsMap.get(m.id) || [],
        reply_to,
        tagged_contacts,
      }
    })

    return NextResponse.json({
      room,
      messages: enrichedMessages,
      has_more,
    })
  } catch (error) {
    console.error('[team-chat] GET room messages unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, full_name, avatar_url, account_role')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    // Verify room belongs to this account
    const { data: room, error: roomErr } = await supabaseAdmin()
      .from('team_rooms')
      .select('id, name, is_direct, dm_user_ids, is_private')
      .eq('id', roomId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (roomErr || !room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    const hasAccess = await canViewRoom(supabase, roomId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    const body = await request.json()
    const {
      content,
      attachments,
      mentioned_user_ids,
      tagged_contact_ids,
      reply_to_id,
    } = body

    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Message content is required' }, { status: 400 })
    }

    const trimmedContent = content.trim()

    // Resolve broadcast mentions (@channel, @everyone, @here)
    const hasChannelMention = /@channel\b/i.test(trimmedContent)
    const hasEveryoneMention = /@everyone\b/i.test(trimmedContent)
    const hasHereMention = /@here\b/i.test(trimmedContent)

    let finalMentionedIds: string[] = Array.isArray(mentioned_user_ids)
      ? [...mentioned_user_ids]
      : []

    if (hasChannelMention || hasEveryoneMention || hasHereMention) {
      const { data: teamProfiles } = await supabaseAdmin()
        .from('profiles')
        .select('user_id, agent_status')
        .eq('account_id', accountId)

      if (teamProfiles && teamProfiles.length > 0) {
        if (hasHereMention && !hasChannelMention && !hasEveryoneMention) {
          const onlineIds = teamProfiles
            .filter((p: any) => p.agent_status === 'online')
            .map((p: any) => p.user_id)
          finalMentionedIds.push(...onlineIds)
        } else {
          finalMentionedIds.push(...teamProfiles.map((p: any) => p.user_id))
        }
      }
    }

    finalMentionedIds = Array.from(new Set(finalMentionedIds.filter(Boolean)))

    // Insert message into database
    const { data: message, error: insertError } = await supabaseAdmin()
      .from('team_messages')
      .insert({
        room_id: roomId,
        account_id: accountId,
        sender_id: user.id,
        content: trimmedContent,
        attachments: Array.isArray(attachments) ? attachments : [],
        mentioned_user_ids: finalMentionedIds,
        tagged_contact_ids: Array.isArray(tagged_contact_ids) ? tagged_contact_ids : [],
        reply_to_id: reply_to_id || null,
      })
      .select()
      .single()

    if (insertError || !message) {
      console.error('[team-chat] Failed to insert message:', insertError)
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
    }

    // Create notifications for mentioned teammates and DM partners
    try {
      const notificationRows = buildNotificationRows({
        accountId,
        senderId: user.id,
        senderName: profile?.full_name || 'Teammate',
        roomId,
        roomName: room.name,
        isDirect: Boolean(room.is_direct),
        dmUserIds: room.dm_user_ids,
        mentionedUserIds: finalMentionedIds,
        content: trimmedContent,
        messageId: message.id,
      })

      if (notificationRows.length > 0) {
        let finalRows = notificationRows
        if (room.is_private) {
          const { data: members } = await supabaseAdmin()
            .from('team_room_members')
            .select('user_id')
            .eq('room_id', roomId)
            .in('user_id', notificationRows.map((r) => r.user_id))
          const allowedUsers = new Set((members || []).map((m: any) => m.user_id))
          finalRows = notificationRows.filter((r) => allowedUsers.has(r.user_id))
        }

        if (finalRows.length > 0) {
          await supabaseAdmin().from('notifications').insert(finalRows)
        }
      }
    } catch (notifErr) {
      console.error('[team-chat] Failed to create notifications:', notifErr)
    }

    // Resolve tagged contacts info if any
    let tagged_contacts: any[] = []
    if (message.tagged_contact_ids && message.tagged_contact_ids.length > 0) {
      const { data: contacts } = await supabaseAdmin()
        .from('contacts')
        .select('id, name, phone, email, avatar_url')
        .in('id', message.tagged_contact_ids)
        .eq('account_id', accountId)

      const { data: convs } = await supabaseAdmin()
        .from('conversations')
        .select('id, contact_id')
        .in('contact_id', message.tagged_contact_ids)
        .eq('account_id', accountId)

      const convMap = new Map((convs || []).map((c: any) => [c.contact_id, c.id]))

      tagged_contacts = (contacts || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        avatar_url: c.avatar_url,
        conversation_id: convMap.get(c.id) || null,
      }))
    }

    const enriched = {
      ...message,
      sender: {
        user_id: user.id,
        full_name: profile?.full_name || 'Team Member',
        avatar_url: profile?.avatar_url || null,
        account_role: profile?.account_role || 'agent',
      },
      reactions: [],
      tagged_contacts,
    }

    return NextResponse.json({ success: true, message: enriched })
  } catch (error) {
    console.error('[team-chat] POST room message unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    // Extract message ID from query string or request body
    const url = new URL(request.url)
    let messageId = url.searchParams.get('messageId')
    if (!messageId) {
      try {
        const body = await request.json()
        messageId = body?.messageId || body?.id
      } catch {
        // body might be empty if query param was intended
      }
    }

    if (!messageId) {
      return NextResponse.json({ error: 'Message ID is required' }, { status: 400 })
    }

    // Verify message exists in this room and account
    const { data: message, error: fetchErr } = await supabaseAdmin()
      .from('team_messages')
      .select('id, sender_id, account_id, room_id')
      .eq('id', messageId)
      .eq('room_id', roomId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (fetchErr || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const hasAccess = await canViewRoom(supabase, message.room_id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    // Author or admin/owner can delete
    const isAuthor = message.sender_id === user.id
    const isAdminOrOwner = profile?.account_role === 'owner' || profile?.account_role === 'admin'

    if (!isAuthor && !isAdminOrOwner) {
      return NextResponse.json(
        { error: 'You do not have permission to delete this message' },
        { status: 403 }
      )
    }

    const { error: delErr } = await supabaseAdmin()
      .from('team_messages')
      .delete()
      .eq('id', messageId)

    if (delErr) {
      console.error('[team-chat] Failed to delete message:', delErr)
      return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 })
    }

    return NextResponse.json({ success: true, messageId })
  } catch (error) {
    console.error('[team-chat] DELETE room message unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


export async function PATCH(
  request: Request,
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

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    const body = await request.json()
    const { messageId, content } = body

    if (!messageId || !content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Message ID and content are required' }, { status: 400 })
    }

    const { data: existing } = await supabaseAdmin()
      .from('team_messages')
      .select('id, sender_id, room_id')
      .eq('id', messageId)
      .eq('room_id', roomId)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const hasAccess = await canViewRoom(supabase, existing.room_id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 })
    }

    const isAuthor = existing.sender_id === user.id
    const isOwnerOrAdmin = profile?.account_role === 'owner' || profile?.account_role === 'admin'
    if (!isAuthor && !isOwnerOrAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: updated, error } = await supabaseAdmin()
      .from('team_messages')
      .update({ content: content.trim(), updated_at: new Date().toISOString() })
      .eq('id', messageId)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, message: updated })
  } catch (error: any) {
    console.error('[team-chat] PATCH message error:', error)
    return NextResponse.json({ error: error.message || 'Failed to edit message' }, { status: 500 })
  }
}
