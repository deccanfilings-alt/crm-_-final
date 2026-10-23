'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Contact, MessageTemplate } from '@/types';
import { canonicalPhone, getPhoneLookupKeys, isUniqueViolation } from '@/lib/contacts/dedupe';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
}

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
}

/**
 * Meta rate-limit buffer. 10 per batch + 1 s pause matches the spec
 * and keeps us comfortably under Meta's per-phone-number messaging
 * rate so a large broadcast never trips the upstream limiter.
 */
const SEND_BATCH_SIZE = 10;
const SEND_BATCH_DELAY_MS = 1000;

/** `broadcast_recipients` inserts are independent of the send rate. */
const INSERT_BATCH_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BroadcastApiResult {
  phone: string;
  status: 'sent' | 'failed';
  whatsapp_message_id?: string;
  error?: string;
}

/** contactId → (customFieldId → value). */
type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.get(v.value) ?? '';
  });
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
async function fetchCustomValueIndex(
  supabase: ReturnType<typeof createClient>,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  // Supabase PostgREST caps the .in(...) IN-clause roughly at 1000
  // values. Page through to stay safe.
  const PAGE = 500;
  for (let i = 0; i < contactIds.length; i += PAGE) {
    const slice = contactIds.slice(i, i + PAGE);
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);

    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      const { data, error } = await supabase.from('contacts').select('*');
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = data ?? [];
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const { data: contactTags, error: tagError } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.tagIds);

      if (tagError)
        throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

      if (contactTags && contactTags.length > 0) {
        const uniqueContactIds = [
          ...new Set(contactTags.map((ct) => ct.contact_id)),
        ];
        const { data, error } = await supabase
          .from('contacts')
          .select('*')
          .in('id', uniqueContactIds);
        if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
        contacts = data ?? [];
      }
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(supabase, audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const { data: excludeRows } = await supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', audience.excludeTagIds);
      const excludedIds = new Set((excludeRows ?? []).map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error('You are not signed in.');
    }
    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    // 1. De-duplicate and canonicalize CSV rows by canonical phone (e.g. 10 digits -> "91" + 10 digits).
    // Keep first row's order, but preserve a name if a later row provides one.
    const canonicalOrder: string[] = [];
    const csvRowByCanonical = new Map<string, { phone: string; name?: string }>();

    for (const row of csvRows) {
      const rawDigits = String(row.phone ?? '').replace(/\D/g, '');
      if (!rawDigits) continue;
      const canon = canonicalPhone(rawDigits);
      if (!csvRowByCanonical.has(canon)) {
        canonicalOrder.push(canon);
        csvRowByCanonical.set(canon, {
          phone: canon,
          name: row.name?.trim() || undefined,
        });
      } else if (!csvRowByCanonical.get(canon)?.name && row.name?.trim()) {
        const existing = csvRowByCanonical.get(canon)!;
        existing.name = row.name.trim();
      }
    }

    if (canonicalOrder.length === 0) return [];

    // 2. Collect all candidate keys that could exist in contacts.phone_normalized
    // (Postgres generates phone_normalized as regexp_replace(phone, '\D', '', 'g') without
    // auto-prefixing 91, so existing numbers may be stored as 10 digits or 12 digits).
    const lookupKeySet = new Set<string>();
    for (const canon of canonicalOrder) {
      lookupKeySet.add(canon);
      for (const key of getPhoneLookupKeys(canon)) {
        lookupKeySet.add(key);
      }
    }
    const allLookupKeys = Array.from(lookupKeySet);

    // 3. Look up existing contacts scoped to the entire account (account_id, NOT user_id),
    // batching in chunks of 100 to avoid URL length limits.
    const existingContacts: Contact[] = [];
    const LOOKUP_CHUNK = 100;
    for (let i = 0; i < allLookupKeys.length; i += LOOKUP_CHUNK) {
      const chunk = allLookupKeys.slice(i, i + LOOKUP_CHUNK);
      const { data, error: lookupErr } = await supabase
        .from('contacts')
        .select('*')
        .eq('account_id', accountId)
        .in('phone_normalized', chunk);

      if (lookupErr) {
        throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
      }
      if (data) {
        existingContacts.push(...(data as Contact[]));
      }
    }

    // 4. Index existing contacts by canonical phone, raw digits, and trunk variants
    const contactByPhoneKey = new Map<string, Contact>();
    for (const c of existingContacts) {
      const digits = String(c.phone_normalized || c.phone || '').replace(/\D/g, '');
      if (!digits) continue;
      const canon = canonicalPhone(digits);
      contactByPhoneKey.set(canon, c);
      contactByPhoneKey.set(digits, c);
      if (c.phone) if (c.phone) if (c.phone) contactByPhoneKey.set(c.phone, c);
      if (c.phone_normalized) contactByPhoneKey.set(c.phone_normalized, c);
      if (digits.length === 12 && digits.startsWith('91')) {
        contactByPhoneKey.set(digits.slice(2), c);
      }
    }

    // 5. Identify contacts genuinely missing from the account
    const missing = canonicalOrder
      .filter((canon) => !contactByPhoneKey.has(canon))
      .map((canon) => ({
        user_id: user.id,
        account_id: accountId,
        phone: canon,
        name: csvRowByCanonical.get(canon)?.name ?? null,
      }));

    // 6. Batch insert missing contacts in chunks of 100, with fallback for 23505 race conditions
    const INSERT_CHUNK = 100;
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();

      if (insertErr) {
        // Fallback: insert row-by-row to catch unique violations or concurrent inserts gracefully
        for (const row of chunk) {
          const { data: singleInserted, error: singleErr } = await supabase
            .from('contacts')
            .insert(row)
            .select()
            .single();

          if (!singleErr && singleInserted) {
            const c = singleInserted as Contact;
            contactByPhoneKey.set(row.phone, c);
          } else if (
            isUniqueViolation(singleErr) ||
            (singleErr as any)?.code === '23505' ||
            /unique constraint|duplicate key|already exists/i.test((singleErr as any)?.message || '') ||
            /unique constraint|duplicate key|already exists/i.test((singleErr as any)?.details || '')
          ) {
            // Already in DB (e.g. concurrent insert or variant format) -> fetch it
            const digits = String(row.phone).replace(/\D/g, '');
            const candidateKeys = Array.from(new Set([digits, ...getPhoneLookupKeys(digits), canonicalPhone(digits)]));
            let { data: found } = await supabase
              .from('contacts')
              .select('*')
              .eq('account_id', accountId)
              .in('phone_normalized', candidateKeys)
              .limit(1)
              .maybeSingle();

            if (!found) {
              const { data: foundByPhone } = await supabase
                .from('contacts')
                .select('*')
                .eq('account_id', accountId)
                .or(`phone.eq.${row.phone},phone.eq.+${digits},phone.eq.${digits}`)
                .limit(1)
                .maybeSingle();
              found = foundByPhone;
            }

            if (!found && digits.length >= 8) {
              const suffix = digits.slice(-10);
              const { data: foundBySuffix } = await supabase
                .from('contacts')
                .select('*')
                .eq('account_id', accountId)
                .like('phone_normalized', `%${suffix}`)
                .limit(1)
                .maybeSingle();
              found = foundBySuffix;
            }

            if (found) {
              const c = found as Contact;
              contactByPhoneKey.set(row.phone, c);
              if (c.phone) contactByPhoneKey.set(c.phone, c);
              if (c.phone_normalized) contactByPhoneKey.set(c.phone_normalized, c);
            }
          } else {
            throw new Error(`Failed to create CSV contacts: ${singleErr?.message || insertErr.message}`);
          }
        }
      } else {
        for (const c of (inserted ?? []) as Contact[]) {
          const digits = String(c.phone_normalized || c.phone || '').replace(/\D/g, '');
          const canon = canonicalPhone(digits);
          contactByPhoneKey.set(canon, c);
          contactByPhoneKey.set(digits, c);
          if (c.phone) if (c.phone) contactByPhoneKey.set(c.phone, c);
          if (c.phone_normalized) contactByPhoneKey.set(c.phone_normalized, c);
        }
      }
    }

    // 7. Preserve input order so recipient sequence matches the CSV order
    return canonicalOrder
      .map((canon) => contactByPhoneKey.get(canon))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive.
    let query = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);

    if (operator === 'is') query = query.eq('value', value);
    else if (operator === 'is_not') query = query.neq('value', value);
    else if (operator === 'contains') query = query.ilike('value', `%${value}%`);

    const { data: matches, error: matchErr } = await query;
    if (matchErr)
      throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set((matches ?? []).map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', contactIds);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    return data ?? [];
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);

    const supabase = createClient();

    try {
      // ── Step 0: Resolve current user ──────────────────────────────
      // broadcasts.user_id is NOT NULL + guarded by RLS
      // (auth.uid() = user_id). Without this, the INSERT below was
      // silently failing with 23502 / 42501 — the wizard would
      // no-op with no feedback.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error('You are not signed in.');
      }
      if (!accountId) {
        throw new Error('Your profile is not linked to an account.');
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // ── Step 2: Create broadcast row ──────────────────────────────
      setProgress(10);
      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            excludeTagIds: payload.audience.excludeTagIds,
          },
          status: 'sending',
          total_recipients: contacts.length,
          sent_count: 0,
          delivered_count: 0,
          read_count: 0,
          replied_count: 0,
          failed_count: 0,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`,
        );
      }

      // ── Step 3: Insert recipient rows ─────────────────────────────
      setProgress(20);
      const recipientRows = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
      }));

      for (let i = 0; i < recipientRows.length; i += INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + INSERT_BATCH_SIZE);
        const { error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort the send loop.
          await supabase
            .from('broadcasts')
            .update({
              status: 'failed',
              failed_count: contacts.length,
            })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${i / INSERT_BATCH_SIZE + 1}: ${recipientError.message}`,
          );
        }
      }

      // ── Step 4: Trigger Server-Side Broadcast Engine ─────────────
      // Hand the entire broadcast (all recipients) to the backend engine.
      // The backend engine handles Meta rate limiting (WHATSAPP_SEND_RATE_PER_SEC),
      // daily unique cap (WHATSAPP_DAILY_UNIQUE_CAP), and marketing cooldowns
      // asynchronously under this single broadcast record.
      setProgress(60);
      const res = await fetch('/api/whatsapp/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broadcastId: broadcast.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to trigger broadcast processing');
      }

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress };
}
