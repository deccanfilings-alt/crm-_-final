import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const limit = checkRateLimit(`init-conv:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const { contactId } = body

    if (!contactId || typeof contactId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid contactId' },
        { status: 400 }
      )
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .single()

    const accountId = profile?.account_id
    if (!accountId) {
      return NextResponse.json(
        { error: 'No account configured' },
        { status: 403 }
      )
    }

    // Check if a conversation already exists for this contact in this account.
    // Query without status restriction: if an existing conversation was closed,
    // we simply reopen it instead of creating a fragmented duplicate thread.
    const { data: existingConvs, error: existingError } = await supabase
      .from('conversations')
      .select('id, status')
      .eq('contact_id', contactId)
      .eq('account_id', accountId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)

    if (existingError) {
      return NextResponse.json(
        { error: 'Failed to query conversations' },
        { status: 500 }
      )
    }

    if (existingConvs && existingConvs.length > 0) {
      const existing = existingConvs[0]
      if (existing.status === 'closed') {
        await supabase
          .from('conversations')
          .update({ status: 'open', updated_at: new Date().toISOString() })
          .eq('id', existing.id)
      }
      return NextResponse.json({ conversationId: existing.id })
    }

    // No existing conversation, create a new one
    const { data: newConv, error: createError } = await supabase
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: user.id,
        contact_id: contactId,
        status: 'open',
      })
      .select('id')
      .single()

    if (createError || !newConv) {
      console.error('Failed to create conversation', createError);
      return NextResponse.json(
        { error: 'Failed to create conversation: ' + (createError?.message || '') },
        { status: 500 }
      )
    }

    return NextResponse.json({ conversationId: newConv.id })
  } catch (error) {
    console.error('Failed to initialize conversation:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
