import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getQuotationSettings, DEFAULT_QUOTATION_SETTINGS } from '@/lib/quotations/settings';

export async function GET() {
  try {
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

    const settings = await getQuotationSettings(supabase, profile.account_id);
    return NextResponse.json({ settings });
  } catch (err: any) {
    console.error('[api/quotations/settings] GET error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json({ error: 'Profile not linked to an account' }, { status: 403 });
    }

    if (!['owner', 'admin'].includes(profile.account_role)) {
      return NextResponse.json({ error: 'Only owners or admins can modify billing settings' }, { status: 403 });
    }

    const body = await request.json();
    const isOwner = profile.account_role === 'owner';

    // Fetch existing settings to verify if bank details are being changed
    const currentSettings = await getQuotationSettings(supabase, profile.account_id);

    const isChangingBankDetails =
      (body.bank_name !== undefined && (body.bank_name?.trim() || '') !== (currentSettings.bank_name || '')) ||
      (body.bank_account_no !== undefined && (body.bank_account_no?.trim() || '') !== (currentSettings.bank_account_no || '')) ||
      (body.bank_ifsc !== undefined && (body.bank_ifsc?.trim() || '') !== (currentSettings.bank_ifsc || '')) ||
      (body.bank_beneficiary_name !== undefined && (body.bank_beneficiary_name?.trim() || '') !== (currentSettings.bank_beneficiary_name || '')) ||
      (body.upi_id !== undefined && (body.upi_id?.trim() || '') !== (currentSettings.upi_id || '')) ||
      (body.upi_qr_url !== undefined && (body.upi_qr_url?.trim() || '') !== (currentSettings.upi_qr_url || ''));

    if (isChangingBankDetails && !isOwner) {
      return NextResponse.json({
        error: 'Security Notice: Only the Account Owner / CEO is authorized to modify company bank account and UPI details.',
      }, { status: 403 });
    }

    const payload = {
      account_id: profile.account_id,
      company_name: body.company_name?.trim() || DEFAULT_QUOTATION_SETTINGS.company_name,
      company_logo_url: body.company_logo_url?.trim() || null,
      company_address: body.company_address?.trim() || null,
      company_phone: body.company_phone?.trim() || null,
      company_email: body.company_email?.trim() || null,
      company_website: body.company_website?.trim() || null,
      gstin: body.gstin?.trim() || null,
      pan: body.pan?.trim() || null,
      // Bank details can strictly only be modified by the owner / CEO
      bank_name: isOwner ? (body.bank_name?.trim() || null) : currentSettings.bank_name,
      bank_account_no: isOwner ? (body.bank_account_no?.trim() || null) : currentSettings.bank_account_no,
      bank_ifsc: isOwner ? (body.bank_ifsc?.trim() || null) : currentSettings.bank_ifsc,
      bank_beneficiary_name: isOwner ? (body.bank_beneficiary_name?.trim() || null) : currentSettings.bank_beneficiary_name,
      upi_id: isOwner ? (body.upi_id?.trim() || null) : currentSettings.upi_id,
      upi_qr_url: isOwner ? (body.upi_qr_url?.trim() || null) : currentSettings.upi_qr_url,
      signature_url: body.signature_url !== undefined ? (body.signature_url?.trim() || null) : null,
      stamp_url: body.stamp_url !== undefined ? (body.stamp_url?.trim() || null) : null,
      default_terms: body.default_terms !== undefined ? body.default_terms : DEFAULT_QUOTATION_SETTINGS.default_terms,
      quote_prefix: body.quote_prefix?.trim() || 'DF-QT-',
      next_quote_number: Math.max(1, parseInt(body.next_quote_number, 10) || 1001),
      default_currency: body.default_currency?.trim() || 'INR',
      default_tax_rate: parseFloat(body.default_tax_rate) || 18.0,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('quotation_settings')
      .upsert(payload, { onConflict: 'account_id' })
      .select()
      .single();

    if (error) {
      console.error('[api/quotations/settings] upsert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, settings: data });
  } catch (err: any) {
    console.error('[api/quotations/settings] POST error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
