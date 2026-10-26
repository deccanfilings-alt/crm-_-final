import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { canViewRoom } from '@/lib/team-chat/room-access'

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
      .select('account_id, user_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    const body = await request.json()
    const { title, target_date, agent_id, message_id } = body

    if (message_id) {
      const { data: message } = await supabaseAdmin()
        .from('team_messages')
        .select('id, room_id')
        .eq('id', message_id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!message) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      }
      const hasAccess = await canViewRoom(supabase, message.room_id)
      if (!hasAccess) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      }
    }

    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'Task title is required' }, { status: 400 })
    }

    const assignedAgentId = agent_id || user.id

    const { data: actionItem, error } = await supabaseAdmin()
      .from('action_items')
      .insert({
        account_id: accountId,
        agent_id: assignedAgentId,
        title: title.trim(),
        status: 'pending',
        target_date: target_date || new Date().toISOString().split('T')[0],
      })
      .select()
      .single()

    if (error) {
      console.error('[team-chat] convert-task error:', error)
      throw error
    }

    return NextResponse.json({ success: true, task: actionItem })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create task' }, { status: 500 })
  }
}
