import type { SupabaseClient } from '@supabase/supabase-js';
import { formatInvoiceNumber, formatQuoteNumber } from './numbering';

export type DocumentKind = 'quote' | 'proforma' | 'tax_invoice';

interface CounterSettings {
  quote_prefix?: string | null;
  next_quote_number?: number | null;
  proforma_prefix?: string | null;
  next_proforma_number?: number | null;
  tax_invoice_prefix?: string | null;
  next_tax_invoice_number?: number | null;
}

/**
 * Get the next quotation / proforma / tax invoice number.
 *
 * Uses next_document_number() (migration 075): allocated in one locked
 * step inside Postgres, works for Team Members (who can't update
 * quotation_settings under RLS), never hands out a number already used.
 *
 * Until 075 is applied it falls back to the old read-then-increment on
 * quotation_settings (best effort; blocked for Team Members by RLS).
 */
export async function allocateDocumentNumber(
  supabase: SupabaseClient,
  accountId: string,
  kind: DocumentKind,
  settings: CounterSettings,
): Promise<string> {
  const { data, error } = await supabase.rpc('next_document_number', { p_kind: kind });
  if (!error && typeof data === 'string' && data) return data;

  if (error && error.code !== 'PGRST202' && error.code !== '42883') {
    // Real failure (e.g. permission) — surface it rather than guess a number.
    throw Object.assign(new Error(error.message || 'Could not allocate a document number'), {
      status: error.code === '42501' ? 403 : 500,
    });
  }

  // Legacy path (migration 075 not applied yet).
  const field =
    kind === 'quote' ? 'next_quote_number' : kind === 'proforma' ? 'next_proforma_number' : 'next_tax_invoice_number';
  const next = Number(settings[field]) || 1001;
  const number =
    kind === 'quote'
      ? formatQuoteNumber(settings.quote_prefix || 'DF-QT-', next)
      : formatInvoiceNumber(
          (kind === 'proforma' ? settings.proforma_prefix : settings.tax_invoice_prefix) || '',
          next,
          kind,
        );
  await supabase
    .from('quotation_settings')
    .update({ [field]: next + 1, updated_at: new Date().toISOString() })
    .eq('account_id', accountId);
  return number;
}

/** Postgres unique violation — the number was taken in the meantime. */
export function isDuplicateNumber(err: { code?: string } | null | undefined): boolean {
  return err?.code === '23505';
}
