import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

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
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 })
    }

    const body = await request.json()
    const { message_id, emoji } = body

    if (!message_id || !emoji) {
      return NextResponse.json({ error: 'message_id and emoji are required' }, { status: 400 })
    }

    // Verify message exists and belongs to caller's account
    const { data: message, error: msgErr } = await supabaseAdmin()
      .from('team_messages')
      .select('id, account_id')
      .eq('id', message_id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (msgErr || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Check if reaction already exists
    const { data: existingReaction } = await supabaseAdmin()
      .from('team_message_reactions')
      .select('id')
      .eq('message_id', message_id)
      .eq('user_id', user.id)
      .eq('emoji', emoji)
      .maybeSingle()

    if (existingReaction) {
      // Remove reaction
      await supabaseAdmin()
        .from('team_message_reactions')
        .delete()
        .eq('id', existingReaction.id)

      return NextResponse.json({ success: true, action: 'removed' })
    } else {
      // Add reaction
      await supabaseAdmin()
        .from('team_message_reactions')
        .insert({
          message_id,
          user_id: user.id,
          emoji,
        })

      return NextResponse.json({ success: true, action: 'added' })
    }
  } catch (error) {
    console.error('[team-chat] Reaction toggle error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
