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

    // Call Meta Graph API for real-time Phone Number Health & Quality Metrics
    const fields = [
      'quality_rating',
      'verified_name',
      'code_verification_status',
      'display_phone_number',
      'name_status',
      'messaging_limit_tier',
      'throughput',
      'is_official_business_account',
    ].join(',');

    const metaRes = await fetch(
      `${META_API_BASE}/${config.phone_number_id}?fields=${fields}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!metaRes.ok) {
      const errBody = await metaRes.json().catch(() => ({}));
      const parsed = parseMetaError(errBody);
      return NextResponse.json(
        {
          configured: true,
          healthy: false,
          error: parsed.userMessage || 'Failed to query Meta Graph API',
          code: parsed.code,
          action: parsed.action,
          rawStatus: metaRes.status,
        },
        { status: 200 }
      );
    }

    const metaData = await metaRes.json();

    const qualityRating = metaData.quality_rating || 'UNKNOWN';
    const isDegraded = qualityRating === 'RED' || qualityRating === 'YELLOW';

    return NextResponse.json({
      configured: true,
      healthy: !isDegraded,
      qualityRating,
      messagingLimitTier: metaData.messaging_limit_tier || 'TIER_UNKNOWN',
      verifiedName: metaData.verified_name || null,
      displayPhoneNumber: metaData.display_phone_number || null,
      nameStatus: metaData.name_status || 'UNKNOWN',
      verificationStatus: metaData.code_verification_status || 'UNKNOWN',
      isOfficialBusinessAccount: !!metaData.is_official_business_account,
      throughput: metaData.throughput || null,
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
