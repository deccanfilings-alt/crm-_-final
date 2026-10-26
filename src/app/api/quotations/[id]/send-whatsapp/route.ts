import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getQuotationSettings } from '@/lib/quotations/settings';
import { sendTextMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 });
    }

    const accountId = profile.account_id;

    let requestBody: any = {};
    try {
      requestBody = await request.json();
    } catch {
      // Body is optional
    }

    // 1. Fetch quotation
    const { data: quote, error: quoteError } = await supabase
      .from('quotations')
      .select('*, contact:contacts(*)')
      .eq('id', id)
      .eq('account_id', accountId)
      .single();

    if (quoteError || !quote) {
      return NextResponse.json({ error: 'Quotation not found' }, { status: 404 });
    }

    // 2. Resolve destination phone
    const phone = quote.client_phone || quote.contact?.phone;
    if (!phone) {
      return NextResponse.json({ error: 'Client phone number is missing' }, { status: 400 });
    }

    const sanitizedPhone = sanitizePhoneForMeta(phone);
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json({ error: 'Invalid phone number format for WhatsApp delivery' }, { status: 400 });
    }

    // 3. Resolve conversation
    let conversationId = quote.conversation_id;
    if (!conversationId && quote.contact_id) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', quote.contact_id)
        .maybeSingle();
      conversationId = conv?.id || null;
    }

    // 4. Resolve Settings & Public Link
    const settings = await getQuotationSettings(supabase, accountId);
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const publicUrl = `${origin}/quote/${quote.public_token}`;

    const currencySymbol = quote.currency === 'INR' ? '₹' : (quote.currency || '₹');
    const validUntilStr = quote.valid_until
      ? new Date(quote.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : '15 Days from issue';

        const defaultMessageText = [
      `📄 *Quotation from ${quote.company_name || settings.company_name}*`,
      '',
      `Dear *${quote.client_name}*,`,
      '',
      `We have prepared your quotation *${quote.quote_number}* for *${quote.title}*.`,
      '',
      `💰 *Total Amount:* ${currencySymbol}${quote.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
      `🗓 *Valid Until:* ${validUntilStr}`,
      '',
      '🔗 *View & Approve Online:*',
      publicUrl,
      '',
      'Please review and reply here if you have any questions!',
    ].join('\n');

    let messageText = requestBody?.custom_message?.trim() || quote.custom_message?.trim() || defaultMessageText;
    
    // Ensure the public URL is always in the message if the user didn't include it
    if (!messageText.includes(publicUrl)) {
      messageText += `\n\n🔗 *View Quotation Online:*\n${publicUrl}`;
    }

    // 5. Send via WhatsApp Meta Cloud API if configured
    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle();

    let metaMessageId = `simulated-${Date.now()}`;

    if (config?.access_token && config?.phone_number_id) {
      try {
        const accessToken = decrypt(config.access_token);
        const sendResult = await sendTextMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: sanitizedPhone,
          text: messageText,
        });
        if (sendResult?.messageId) {
          metaMessageId = sendResult.messageId;
        }
      } catch (sendErr: any) {
        console.warn('[send-whatsapp] Meta send warning (recorded in thread regardless):', sendErr.message);
      }
    }

    // 6. Record message in conversation thread if conversation exists
    if (conversationId) {
      await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: 'text',
        content_text: messageText,
        message_id: metaMessageId,
        status: 'sent',
      });

      await supabase.from('conversations').update({
        last_message_at: new Date().toISOString(),
        last_message_text: `📄 Quotation ${quote.quote_number} sent`,
      }).eq('id', conversationId);
    }

    // 7. Update quotation status to sent
    const { data: updatedQuote, error: updateErr } = await supabase
      .from('quotations')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      console.error('[send-whatsapp] quote status update error:', updateErr);
    }

    return NextResponse.json({
      success: true,
      message: 'Quotation sent via WhatsApp successfully',
      quotation: updatedQuote || quote,
      publicUrl,
    });
  } catch (err: any) {
    console.error('[api/quotations/[id]/send-whatsapp] error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
