import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'

export async function POST(req: Request) {
  try {
    // 1. Verify the secret token
    const authHeader = req.headers.get('authorization')
    const secret = process.env.WEBHOOK_SECRET
    
    if (!secret) {
      return NextResponse.json({ error: 'Webhook secret not configured on CRM server' }, { status: 500 })
    }
    
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Parse the payload from the Node.js website
    const body = await req.json()
    const { name, phone, email, company } = body

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    // 3. Connect to Supabase using the Service Role Key (bypasses RLS for background tasks)
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 4. Get the primary account for Deccan Filings
    const { data: accounts, error: accountError } = await supabaseAdmin
      .from('accounts')
      .select('id, owner_user_id')
      .limit(1)
      .single()

    if (accountError || !accounts) {
      return NextResponse.json({ error: 'Could not find a valid CRM account' }, { status: 500 })
    }

    // 5. De-duplicate: check if contact already exists in this account
    const existing = await findExistingContact(supabaseAdmin, accounts.id, phone.trim())
    if (existing) {
      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if ((!existing.name || existing.name === existing.phone) && name?.trim()) {
        updates.name = name.trim()
      }
      if (!existing.email && email?.trim()) {
        updates.email = email.trim()
      }
      if (!existing.company && company?.trim()) {
        updates.company = company.trim()
      }

      if (Object.keys(updates).length > 1) {
        await supabaseAdmin
          .from('contacts')
          .update(updates)
          .eq('id', existing.id)
      }

      return NextResponse.json({
        success: true,
        contact: { ...existing, ...updates },
        wasExisting: true,
      })
    }

    // 6. Insert the new contact
    const { data: contact, error: insertError } = await supabaseAdmin
      .from('contacts')
      .insert({
        user_id: accounts.owner_user_id,
        account_id: accounts.id,
        name: name?.trim() || null,
        phone: phone.trim(),
        email: email?.trim() || null,
        company: company?.trim() || null,
      })
      .select()
      .single()

    if (insertError) {
      if (isUniqueViolation(insertError)) {
        const raced = await findExistingContact(supabaseAdmin, accounts.id, phone.trim())
        if (raced) {
          return NextResponse.json({ success: true, contact: raced, wasExisting: true })
        }
      }
      console.error('Error inserting contact:', insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, contact, wasExisting: false })
  } catch (err: any) {
    console.error('Webhook Error:', err)
    return NextResponse.json({ error: 'Internal Server Error', details: err.message }, { status: 500 })
  }
}
