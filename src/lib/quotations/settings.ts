import type { SupabaseClient } from '@supabase/supabase-js';
import type { QuotationSettings } from '@/types';

export const DEFAULT_QUOTATION_SETTINGS: Omit<QuotationSettings, 'account_id' | 'created_at' | 'updated_at'> = {
  company_name: 'Deccan Filings',
  company_logo_url: null,
  company_address: 'Hyderabad, Telangana, India',
  company_phone: '+91 99999 99999',
  company_email: 'support@deccanfilings.com',
  company_website: 'https://deccanfilings.com',
  gstin: null,
  pan: null,
  bank_name: null,
  bank_account_no: null,
  bank_ifsc: null,
  bank_beneficiary_name: null,
  upi_id: null,
  upi_qr_url: null,
  default_terms: '1. Quotation valid for 15 days from issue date.\n2. 50% advance before project commencement.\n3. Statutory govt fees subject to actual receipts.',
  quote_prefix: 'DF-QT-',
  next_quote_number: 1001,
  default_currency: 'INR',
  default_tax_rate: 18.0,
};

export async function getQuotationSettings(
  supabase: SupabaseClient,
  accountId: string
): Promise<QuotationSettings> {
  const { data, error } = await supabase
    .from('quotation_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error) {
    console.warn('[getQuotationSettings] error:', error.message);
  }

  if (data) {
    return data as QuotationSettings;
  }

  // Return synthetic defaults if not yet customized
  return {
    ...DEFAULT_QUOTATION_SETTINGS,
    account_id: accountId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
