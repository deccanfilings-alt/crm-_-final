import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { fetchFacebookUserProfile } from '@/lib/meta/channels-api';

interface FacebookMessageEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: { url: string };
    }>;
    quick_reply?: {
      payload: string;
    };
  };
  postback?: {
    title: string;
    payload: string;
  };
}

interface FacebookWebhookEntry {
  id: string; // Facebook Page ID
  time: number;
  messaging?: FacebookMessageEvent[];
}

/**
 * GET - Webhook verification for Facebook Page / Messenger
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const challenge = searchParams.get('hub.challenge');
    const verifyToken = searchParams.get('hub.verify_token');

    if (mode !== 'subscribe' || !challenge || !verifyToken) {
      return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 });
    }

    const globalVerifyToken = process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
    if (globalVerifyToken && verifyToken === globalVerifyToken) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    const { data: connections } = await supabaseAdmin()
      .from('channel_connections')
      .select('verify_token')
      .eq('channel_type', 'facebook');

    let matched = false;
    if (connections) {
      for (const conn of connections) {
        if (!conn.verify_token) continue;
        try {
          if (decrypt(conn.verify_token) === verifyToken || conn.verify_token === verifyToken) {
            matched = true;
            break;
          }
        } catch {
          if (conn.verify_token === verifyToken) {
            matched = true;
            break;
          }
        }
      }
    }

    if (matched) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
  } catch (err: unknown) {
    console.error('Error in Facebook webhook GET verification:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST - Inbound Facebook Messenger event processor
 */
export async function POST(request: Request) {
  try {
    const body: { object?: string; entry?: FacebookWebhookEntry[] } = await request.json();

    if (body.object !== 'page' || !body.entry) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    void processFacebookWebhook(body.entry).catch(err => {
      console.error('Error processing Facebook webhook entries:', err);
    });

    return NextResponse.json({ status: 'received' }, { status: 200 });
  } catch (err: unknown) {
    console.error('Error parsing Facebook webhook body:', err);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}

async function processFacebookWebhook(entries: FacebookWebhookEntry[]) {
  const db = supabaseAdmin();

  for (const entry of entries) {
    const pageId = entry.id;

    const { data: connection } = await db
      .from('channel_connections')
      .select('*')
      .eq('page_id', pageId)
      .eq('channel_type', 'facebook')
      .eq('status', 'connected')
      .maybeSingle();

    if (!connection) {
      console.warn(`[Facebook Webhook] No connected channel found for Page ID ${pageId}`);
      continue;
    }

    let accessToken = connection.access_token;
    try {
      accessToken = decrypt(accessToken);
    } catch {
      // Plaintext or unencrypted
    }

    if (!entry.messaging || entry.messaging.length === 0) continue;

    for (const event of entry.messaging) {
      const senderPsid = event.sender?.id;
      if (!senderPsid || senderPsid === pageId) continue;

      const text = event.message?.text || event.postback?.title || '';
      const messageId = event.message?.mid || `fb_${Date.now()}`;

      // Fetch or create Contact
      let { data: contact } = await db
        .from('contacts')
        .select('*')
        .eq('account_id', connection.account_id)
        .eq('facebook_psid', senderPsid)
        .maybeSingle();

      if (!contact) {
        const profile = await fetchFacebookUserProfile({
          psid: senderPsid,
          accessToken,
        });

        const displayName = profile.name || `Facebook User (${senderPsid.slice(-4)})`;

        const { data: newContact, error: contactErr } = await db
          .from('contacts')
          .insert({
            account_id: connection.account_id,
            user_id: connection.user_id || '00000000-0000-0000-0000-000000000000',
            name: displayName,
            facebook_psid: senderPsid,
            avatar_url: profile.profilePic || null,
          })
          .select()
          .single();

        if (contactErr) {
          console.error('[Facebook Webhook] Error creating contact:', contactErr);
          continue;
        }
        contact = newContact;
      }

      // Find or create Conversation
      const { data: existingConvs } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', connection.account_id)
        .eq('contact_id', contact.id)
        .eq('channel', 'facebook')
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1);

      let conversation = existingConvs && existingConvs.length > 0 ? existingConvs[0] : null;

      if (!conversation) {
        const { data: newConv, error: convErr } = await db
          .from('conversations')
          .insert({
            account_id: connection.account_id,
            user_id: contact.user_id,
            contact_id: contact.id,
            channel: 'facebook',
            status: 'open',
            unread_count: 1,
            last_message_text: text,
            last_message_at: new Date().toISOString(),
            last_customer_message_at: new Date().toISOString(),
            sla_breached_at: null,
          })
          .select()
          .single();

        if (convErr) {
          console.error('[Facebook Webhook] Error creating conversation:', convErr);
          continue;
        }
        conversation = newConv;
      } else {
        await db
          .from('conversations')
          .update({
            status: 'open',
            unread_count: (conversation.unread_count || 0) + 1,
            last_message_text: text || 'Media attachment',
            last_message_at: new Date().toISOString(),
            last_customer_message_at: new Date().toISOString(),
            sla_breached_at: null,
          })
          .eq('id', conversation.id);
      }

      // Determine content type
      let contentType = 'text';
      let mediaUrl: string | undefined = undefined;
      if (event.message?.attachments && event.message.attachments.length > 0) {
        const att = event.message.attachments[0];
        contentType = att.type === 'image' ? 'image' : att.type === 'video' ? 'video' : 'document';
        mediaUrl = att.payload.url;
      }

      // Persist message
      await db.from('messages').insert({
        conversation_id: conversation.id,
        sender_type: 'customer',
        content_type: contentType,
        content_text: text,
        media_url: mediaUrl,
        message_id: messageId,
        status: 'delivered',
        created_at: new Date(event.timestamp || Date.now()).toISOString(),
      });
    }
  }
}
