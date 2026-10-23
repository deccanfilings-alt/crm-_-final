import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { processBroadcast } from '@/lib/whatsapp/broadcast-engine';
import { validateBroadcastPhone } from '@/lib/whatsapp/phone-utils';
import { findExistingContact } from '@/lib/contacts/dedupe';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { broadcastId, title, name, template_name, language_code, template_language, recipients, phone_numbers } = body;

    // Case 1: Trigger background processing for an existing broadcast
    if (broadcastId && (!recipients || recipients.length === 0)) {
      processBroadcast(supabaseAdmin(), broadcastId).catch((err) => {
        console.error("Async broadcast processing error:", err);
      });
      return NextResponse.json({ success: true, broadcastId });
    }

    // Case 2: Create a new broadcast draft/queue
    const rawRecipients = recipients || phone_numbers || [];
    if (!rawRecipients || rawRecipients.length === 0) {
      return NextResponse.json(
        { error: 'Provide either broadcastId or recipients/phone_numbers — must be non-empty' },
        { status: 400 }
      );
    }

    // Fetch user's account_id for multi-tenancy RLS
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const accountId = profile?.account_id;
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked to user' }, { status: 403 });
    }

    // Daily Cap Pre-Validation
    const DAILY_CAP = parseInt(process.env.WHATSAPP_DAILY_UNIQUE_CAP || '250', 10);
    const uniquePhonesInRequest = new Set(
      rawRecipients.map((r: any) => typeof r === 'string' ? r : r.phone)
    );

    if (uniquePhonesInRequest.size > DAILY_CAP) {
      return NextResponse.json(
        {
          error: `Broadcast exceeds daily unique recipient cap of ${DAILY_CAP}. Contact count: ${uniquePhonesInRequest.size}.`
        },
        { status: 400 }
      );
    }

    // Create Broadcast record matching database schema (user_id, account_id, name, template_language, sent_count, failed_count)
    const broadcastName = name || title || `Broadcast ${new Date().toISOString()}`;
    const lang = template_language || language_code || 'en_US';

    const { data: broadcast, error: broadcastError } = await supabase
      .from('broadcasts')
      .insert({
        user_id: user.id,
        account_id: accountId,
        name: broadcastName,
        template_name: template_name || 'marketing_template',
        template_language: lang,
        status: 'sending',
        total_recipients: rawRecipients.length,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
        heartbeat_at: new Date().toISOString()
      })
      .select()
      .single();

    if (broadcastError || !broadcast) {
      return NextResponse.json({ error: broadcastError?.message || 'Failed to create broadcast' }, { status: 500 });
    }

    // Validate phone numbers, resolve contacts & prepare recipient rows matching database schema
    const recipientRows: Array<{
      broadcast_id: string;
      contact_id: string | null;
      status: string;
      error_message: string | null;
    }> = [];

    for (const r of rawRecipients) {
      const rawPhone = typeof r === 'string' ? r : r.phone;
      let contactId = typeof r === 'object' ? r.contact_id : null;
      const validation = validateBroadcastPhone(rawPhone);

      if (!contactId && validation.isValid && validation.sanitized) {
        const existing = await findExistingContact(supabaseAdmin(), accountId, validation.sanitized);
        if (existing) {
          contactId = existing.id;
        } else {
          const { data: newContact } = await supabaseAdmin()
            .from('contacts')
            .insert({
              account_id: accountId,
              user_id: user.id,
              phone: validation.sanitized,
              name: (typeof r === 'object' && r.name) ? r.name : validation.sanitized
            })
            .select('id')
            .maybeSingle();
          if (newContact) {
            contactId = newContact.id;
          }
        }
      }

      recipientRows.push({
        broadcast_id: broadcast.id,
        contact_id: contactId,
        status: validation.isValid ? 'queued' : 'quarantined',
        error_message: validation.isValid ? null : `Quarantined: ${validation.reason}`
      });
    }

    const { error: recipientsError } = await supabase
      .from('broadcast_recipients')
      .insert(recipientRows);

    if (recipientsError) {
      return NextResponse.json({ error: recipientsError.message }, { status: 500 });
    }

    // Immediately trigger processing engine asynchronously
    processBroadcast(supabaseAdmin(), broadcast.id).catch(err => {
      console.error('Async broadcast processing error:', err);
    });

    return NextResponse.json({
      success: true,
      broadcastId: broadcast.id,
      total: recipientRows.length,
      quarantined: recipientRows.filter((r: { status: string }) => r.status === 'quarantined').length
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
