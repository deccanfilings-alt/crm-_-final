import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { decrypt } from '@/lib/whatsapp/encryption';
import { META_API_BASE } from '@/lib/whatsapp/meta-api';
import { parseMetaError } from '@/lib/whatsapp/meta-errors';

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json({ error: 'No account linked' }, { status: 403 });
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();

    if (configError || !config) {
      return NextResponse.json(
        {
          configured: false,
          healthy: false,
          error: 'WhatsApp is not configured for this account.',
        },
        { status: 200 }
      );
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch {
      return NextResponse.json(
        {
          configured: true,
          healthy: false,
          error: 'Failed to decrypt Meta access token.',
          code: 'TOKEN_DECRYPTION_FAILED',
        },
        { status: 500 }
      );
    }

    const authHeader = { Authorization: `Bearer ${accessToken}` };

    // 1. Live read from PHONE_NUMBER_ID
    const phoneFields = 'status,quality_rating,throughput,display_phone_number,verified_name';
    const phoneRes = await fetch(`${META_API_BASE}/${config.phone_number_id}?fields=${phoneFields}`, {
      headers: authHeader,
    });

    if (!phoneRes.ok) {
      const errBody = await phoneRes.json().catch(() => ({}));
      const parsed = parseMetaError(errBody);
      return NextResponse.json(
        {
          configured: true,
          healthy: false,
          error: parsed.userMessage || 'Failed to query Phone Number health from Meta',
          code: parsed.code,
          action: parsed.action,
        },
        { status: 200 }
      );
    }
    const phoneData = await phoneRes.json();

    // 2. Live read from WABA_ID for messaging limit
    let messagingLimit = null;
    if (config.waba_id) {
      const wabaRes = await fetch(
        `${META_API_BASE}/${config.waba_id}?fields=whatsapp_business_manager_messaging_limit`,
        { headers: authHeader }
      );
      if (wabaRes.ok) {
        const wabaData = await wabaRes.json();
        messagingLimit = wabaData.whatsapp_business_manager_messaging_limit || null;
      }
    }

    // 3. Live read from WABA_ID/message_templates for status & quality score
    let templates: any[] = [];
    let pausedOrDisabledTemplates: any[] = [];
    if (config.waba_id) {
      const tplRes = await fetch(
        `${META_API_BASE}/${config.waba_id}/message_templates?fields=name,language,status,quality_score`,
        { headers: authHeader }
      );
      if (tplRes.ok) {
        const tplData = await tplRes.json();
        templates = tplData.data || [];
        pausedOrDisabledTemplates = templates.filter(
          (t) => t.status === 'PAUSED' || t.status === 'DISABLED' || t.status === 'REJECTED'
        );
      }
    }

    const qualityRating = phoneData.quality_rating || 'UNKNOWN';
    const isDegraded = qualityRating === 'RED' || qualityRating === 'YELLOW' || phoneData.status === 'RESTRICTED' || phoneData.status === 'FLAGGED';

    return NextResponse.json({
      configured: true,
      healthy: !isDegraded && pausedOrDisabledTemplates.length === 0,
      phoneStatus: phoneData.status || 'CONNECTED',
      qualityRating,
      messagingLimit: messagingLimit || 'NOT_SET',
      verifiedName: phoneData.verified_name || null,
      displayPhoneNumber: phoneData.display_phone_number || null,
      throughput: phoneData.throughput || null,
      templatesCount: templates.length,
      pausedOrDisabledCount: pausedOrDisabledTemplates.length,
      pausedOrDisabledTemplates: pausedOrDisabledTemplates.map((t) => ({
        name: t.name,
        language: t.language,
        status: t.status,
        qualityScore: t.quality_score?.score || null,
      })),
      phoneNumberId: config.phone_number_id,
      wabaId: config.waba_id,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[whatsapp/health] Error checking WhatsApp health:', error);
    return NextResponse.json(
      {
        configured: true,
        healthy: false,
        error: error instanceof Error ? error.message : 'Internal diagnostic error',
      },
      { status: 500 }
    );
  }
}
