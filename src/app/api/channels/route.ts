import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { verifyPageAndInstagramAccount } from '@/lib/meta/channels-api';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .single();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 403 });
    }

    const { data: connections, error } = await supabaseAdmin()
      .from('channel_connections')
      .select('id, channel_type, page_id, page_name, instagram_business_id, instagram_username, status, connected_at')
      .eq('account_id', profile.account_id);

    if (error) throw error;

    return NextResponse.json(connections || []);
  } catch (err: unknown) {
    console.error('Error fetching channel connections:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .single();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 403 });
    }

    const body = await req.json();
    const { channel_type, page_id, access_token, verify_token } = body;

    if (!channel_type || !page_id || !access_token) {
      return NextResponse.json(
        { error: 'channel_type, page_id, and access_token are required' },
        { status: 400 }
      );
    }

    // Verify token with Meta Graph API
    let metaInfo;
    try {
      metaInfo = await verifyPageAndInstagramAccount({
        pageId: page_id,
        accessToken: access_token,
      });
    } catch (metaErr) {
      return NextResponse.json(
        { error: `Meta Verification Failed: ${(metaErr as Error).message}` },
        { status: 400 }
      );
    }

    const encryptedToken = encrypt(access_token);
    const encryptedVerifyToken = verify_token ? encrypt(verify_token) : null;

    const { data: record, error: upsertError } = await supabaseAdmin()
      .from('channel_connections')
      .upsert(
        {
          account_id: profile.account_id,
          user_id: user.id,
          channel_type,
          page_id: metaInfo.pageId,
          page_name: metaInfo.pageName,
          instagram_business_id: metaInfo.instagramBusinessId,
          instagram_username: metaInfo.instagramUsername,
          access_token: encryptedToken,
          verify_token: encryptedVerifyToken,
          status: 'connected',
          connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,channel_type,page_id' }
      )
      .select('id, channel_type, page_id, page_name, instagram_business_id, instagram_username, status, connected_at')
      .single();

    if (upsertError) throw upsertError;

    return NextResponse.json(record);
  } catch (err: unknown) {
    console.error('Error saving channel connection:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .single();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Account not found' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Channel ID is required' }, { status: 400 });
    }

    const { error } = await supabaseAdmin()
      .from('channel_connections')
      .delete()
      .eq('id', id)
      .eq('account_id', profile.account_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('Error deleting channel connection:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
