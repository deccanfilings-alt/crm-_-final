import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: survivorId } = await params
    const { loserId } = await req.json()
    const supabase = await createClient()

    if (!survivorId || !loserId) {
      return NextResponse.json({ error: 'Missing contact IDs' }, { status: 400 })
    }

    const { data: userData, error: authError } = await supabase.auth.getUser()
    if (authError || !userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // manual_merge_contacts internally checks that the caller is an owner/admin
    // and that both contacts belong to their account.
    const { error: mergeError } = await supabase.rpc('manual_merge_contacts', {
      v_survivor: survivorId,
      v_loser: loserId,
    })

    if (mergeError) {
      console.error('[API] Contact Merge failed:', mergeError)
      return NextResponse.json({ error: mergeError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[API] Contact Merge exception:', err)
    return NextResponse.json(
      { error: 'Internal server error during merge' },
      { status: 500 }
    )
  }
}
