import type { SupabaseClient } from '@supabase/supabase-js';
import { cleanDisplayName, DEFAULT_NAME_FALLBACK } from '@/lib/contacts/display-name';

export interface PlaceholderContact {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  custom?: Record<string, string | null>;
}

export async function loadPlaceholderContact(
  db: SupabaseClient | any,
  accountId: string,
  contactId: string,
): Promise<PlaceholderContact | null> {
  try {
    const { data, error } = await db
      .from('contacts')
      .select('name, phone, email, company, contact_custom_values(value, custom_fields(field_name))')
      .eq('account_id', accountId)
      .eq('id', contactId)
      .maybeSingle();

    if (error || !data) {
      if (error) console.error('[contact-placeholders] Error loading contact:', error);
      return null;
    }

    const custom: Record<string, string | null> = {};
    if (data.contact_custom_values && Array.isArray(data.contact_custom_values)) {
      for (const row of data.contact_custom_values as any[]) {
        const fieldName = Array.isArray(row.custom_fields)
          ? row.custom_fields[0]?.field_name
          : row.custom_fields?.field_name;
        if (fieldName && typeof fieldName === 'string') {
          custom[fieldName.toLowerCase().trim()] = row.value ?? null;
        }
      }
    }

    return {
      name: data.name,
      phone: data.phone,
      email: data.email,
      company: data.company,
      custom,
    };
  } catch (err) {
    console.error('[contact-placeholders] Unexpected error in loadPlaceholderContact:', err);
    return null;
  }
}

export function resolveContactPlaceholders(
  text: string,
  contact?: PlaceholderContact | null,
): string {
  if (!text || typeof text !== 'string') return '';

  const regex = /\{\{\s*contact\.([a-z_]+)(?:\.([^}|]+?))?\s*(?:\|([^}]*))?\}\}/gi;

  return text.replace(regex, (_, field, subfield, fallback) => {
    const key = field.toLowerCase();
    const fb = fallback !== undefined ? fallback : undefined;

    if (key === 'name') {
      return cleanDisplayName(contact?.name, fb !== undefined ? fb : DEFAULT_NAME_FALLBACK);
    }

    if (key === 'first_name') {
      const nameFallback = fb !== undefined ? fb : DEFAULT_NAME_FALLBACK;
      const cleaned = cleanDisplayName(contact?.name, nameFallback);
      if (cleaned === nameFallback) {
        return nameFallback;
      }
      return cleaned.split(' ')[0] || nameFallback;
    }

    if (key === 'phone') {
      return (contact?.phone && contact.phone.trim()) || fb || '';
    }

    if (key === 'email') {
      return (contact?.email && contact.email.trim()) || fb || '';
    }

    if (key === 'company') {
      return (contact?.company && contact.company.trim()) || fb || '';
    }

    if (key === 'custom' && subfield) {
      const customKey = subfield.toLowerCase().trim();
      const val = contact?.custom ? contact.custom[customKey] : null;
      return (val && val.trim()) || fb || '';
    }

    return fb || '';
  });
}
