import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

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

    // Fetch messages for this room (limit to last 200 messages)
    const { data: rawMessages, error: msgError } = await supabaseAdmin()
      .from('team_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(200)

    if (msgError) {
      console.error('[team-chat] Error fetching messages:', msgError)
      return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
    }

    const messages = rawMessages || []

    // Collect sender IDs and tagged contact IDs
    const senderIds = Array.from(new Set(messages.map((m: any) => m.sender_id).filter(Boolean)))
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
        tagged_contacts,
      }
    })

    return NextResponse.json({
      room,
      messages: enrichedMessages,
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
      .select('id, name')
      .eq('id', roomId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (roomErr || !room) {
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

    // Resolve tagged contacts info if any
    let tagged_contacts: any[] = []
    if (message.tagged_contact_ids && message.tagged_contact_ids.length > 0) {
      const { data: contacts } = await supabaseAdmin()
        .from('contacts')
        .select('id, name, phone, email, avatar_url')
        .in('id', message.tagged_contact_ids)

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

