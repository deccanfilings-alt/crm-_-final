import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = (searchParams.get('q') || '').trim()

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

    // 1. Fetch team members in the same account
    let membersQuery = supabaseAdmin()
      .from('profiles')
      .select('user_id, full_name, avatar_url, account_role, email')
      .eq('account_id', accountId)
      .limit(10)

    if (query) {
      membersQuery = membersQuery.ilike('full_name', `%${query}%`)
    }

    const { data: members, error: memErr } = await membersQuery
    if (memErr) {
      console.error('[team-chat] Error fetching mention members:', memErr)
    }

    // 2. Fetch real CRM contacts in the same account
    let contactsQuery = supabaseAdmin()
      .from('contacts')
      .select('id, name, phone, email, avatar_url')
      .eq('account_id', accountId)
      .limit(15)

    if (query) {
      contactsQuery = contactsQuery.or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
    }

    const { data: rawContacts, error: conErr } = await contactsQuery
    if (conErr) {
      console.error('[team-chat] Error fetching mention contacts:', conErr)
    }

    // Resolve conversation ID for each contact
    const contactIds = (rawContacts || []).map((c: any) => c.id)
    let convMap = new Map<string, string>()
    if (contactIds.length > 0) {
      const { data: convs } = await supabaseAdmin()
        .from('conversations')
        .select('id, contact_id')
        .in('contact_id', contactIds)
        .eq('account_id', accountId)
      convMap = new Map((convs || []).map((c: any) => [c.contact_id, c.id]))
    }

    const contacts = (rawContacts || []).map((c: any) => ({
      ...c,
      conversation_id: convMap.get(c.id) || null,
    }))

    return NextResponse.json({
      members: members || [],
      contacts: contacts || [],
    })
  } catch (error) {
    console.error('[team-chat] search-mentions unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
