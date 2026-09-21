import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  fetchInstagramUserProfile,
  replyToInstagramComment,
  sendInstagramPrivateCommentReply,
} from '@/lib/meta/channels-api';

interface InstagramMessageEvent {
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
}

interface InstagramCommentChange {
  field: 'comments';
  value: {
    id: string;
    text: string;
    from: { id: string; username: string };
    media: { id: string; media_product_type?: string };
    parent_id?: string;
  };
}

interface InstagramWebhookEntry {
  id: string; // Instagram Business Account ID
  time: number;
  messaging?: InstagramMessageEvent[];
  changes?: InstagramCommentChange[];
}

/**
 * GET - Webhook verification for Instagram
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

    // Check against global env or any registered channel_connections
    const globalVerifyToken = process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN;
    if (globalVerifyToken && verifyToken === globalVerifyToken) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    const { data: connections } = await supabaseAdmin()
      .from('channel_connections')
      .select('verify_token')
      .eq('channel_type', 'instagram');

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
    console.error('Error in Instagram webhook GET verification:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST - Inbound Instagram message and comment event processor
 */
export async function POST(request: Request) {
  try {
    const body: { object?: string; entry?: InstagramWebhookEntry[] } = await request.json();

    if (body.object !== 'instagram' || !body.entry) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    // Process asynchronously to respond within Meta's 20-second timeout
    void processInstagramWebhook(body.entry).catch(err => {
      console.error('Error processing Instagram webhook entries:', err);
    });

    return NextResponse.json({ status: 'received' }, { status: 200 });
  } catch (err: unknown) {
    console.error('Error parsing Instagram webhook body:', err);
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}

async function processInstagramWebhook(entries: InstagramWebhookEntry[]) {
  const db = supabaseAdmin();

  for (const entry of entries) {
    const igAccountId = entry.id;

    // Find the associated channel connection and account
    const { data: connection } = await db
      .from('channel_connections')
      .select('*')
      .or(`instagram_business_id.eq.${igAccountId},page_id.eq.${igAccountId}`)
      .eq('status', 'connected')
      .maybeSingle();

    if (!connection) {
      console.warn(`[Instagram Webhook] No connected channel found for IG account ${igAccountId}`);
      continue;
    }

    let accessToken = connection.access_token;
    try {
      accessToken = decrypt(accessToken);
    } catch {
      // Plaintext or unencrypted
    }

    // 1. Process Direct Messages
    if (entry.messaging && entry.messaging.length > 0) {
      for (const event of entry.messaging) {
        if (!event.message) continue;

        const senderIgsid = event.sender.id;
        const text = event.message.text || '';
        const messageId = event.message.mid;

        // Skip echo / outbound messages sent by the page itself
        if (senderIgsid === igAccountId || senderIgsid === connection.instagram_business_id) {
          continue;
        }

        // Fetch or create Contact
        let { data: contact } = await db
          .from('contacts')
          .select('*')
          .eq('account_id', connection.account_id)
          .eq('instagram_id', senderIgsid)
          .maybeSingle();

        if (!contact) {
          // Fetch real user metadata from Instagram Graph API
          const profile = await fetchInstagramUserProfile({
            igsid: senderIgsid,
            accessToken,
          });

          const displayName = profile.name || (profile.username ? `@${profile.username}` : `Instagram User (${senderIgsid.slice(-4)})`);

          const { data: newContact, error: contactErr } = await db
            .from('contacts')
            .insert({
              account_id: connection.account_id,
              user_id: connection.user_id || '00000000-0000-0000-0000-000000000000',
              name: displayName,
              instagram_id: senderIgsid,
              instagram_username: profile.username || null,
              avatar_url: profile.profilePic || null,
            })
            .select()
            .single();

          if (contactErr) {
            console.error('[Instagram Webhook] Error creating contact:', contactErr);
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
          .eq('channel', 'instagram')
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
              channel: 'instagram',
              status: 'open',
              unread_count: 1,
              last_message_text: text,
              last_message_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (convErr) {
            console.error('[Instagram Webhook] Error creating conversation:', convErr);
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
            })
            .eq('id', conversation.id);
        }

        // Determine content type & media URL
        let contentType = 'text';
        let mediaUrl: string | undefined = undefined;
        if (event.message.attachments && event.message.attachments.length > 0) {
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
          created_at: new Date(event.timestamp).toISOString(),
        });
      }
    }

    // 2. Process Comments on Posts / Reels (Comment-to-DM triggers)
    if (entry.changes && entry.changes.length > 0) {
      for (const change of entry.changes) {
        if (change.field === 'comments') {
          const comment = change.value;
          const commentText = comment.text?.trim();
          const commentId = comment.id;
          const fromUsername = comment.from?.username;

          console.log(`[Instagram Webhook] New comment from @${fromUsername}: "${commentText}" on media ${comment.media?.id}`);

          // Check if there is an active keyword trigger (e.g., "PRICE", "INFO", "LINK", "START")
          const triggerKeywords = ['price', 'info', 'link', 'dm', 'details', 'interested'];
          const matched = triggerKeywords.some(kw => commentText?.toLowerCase().includes(kw));

          if (matched && commentId) {
            try {
              // 1. Reply publicly on the comment
              await replyToInstagramComment({
                commentId,
                message: `Hi @${fromUsername}! Sent you the details via Direct Message 📥 Check your requests!`,
                accessToken,
              });

              // 2. Send private DM to user
              await sendInstagramPrivateCommentReply({
                commentId,
                text: `Hey @${fromUsername}! Thanks for commenting on our post. Here is the link and pricing info you requested! Let us know how we can help you.`,
                accessToken,
              });
            } catch (dmErr) {
              console.error('[Instagram Webhook] Error sending comment-to-DM auto reply:', dmErr);
            }
          }
        }
      }
    }
  }
}
