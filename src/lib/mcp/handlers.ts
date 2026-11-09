import { supabaseAdmin } from '@/lib/flows/admin-client';
import { callTool } from './dispatch';
import type { McpContext } from './context';
import type { MCPToolCallParams, MCPToolResult } from './types';

export const CONTACT_RELATIONS =
  'contact_tags(tags(name)), contact_custom_values(value, custom_fields(field_name))';
export const MESSAGE_COLUMNS =
  'id, sender_type, sender_id, content_type, content_text, media_url, template_name, message_id, status, is_internal, created_at';

export function flattenContact(row: any) {
  if (!row) return row;
  const { contact_tags, contact_custom_values, ...rest } = row;
  const tags: string[] = (contact_tags || [])
    .map((ct: any) => ct?.tags?.name)
    .filter((n: any): n is string => Boolean(n));

  const custom_fields: Record<string, string | null> = {};
  for (const ccv of (contact_custom_values || [])) {
    const fieldName = ccv?.custom_fields?.field_name;
    if (fieldName) {
      custom_fields[fieldName] = ccv?.value ?? null;
    }
  }

  return {
    ...rest,
    tags,
    custom_fields,
  };
}

export function toDbConversationStatus(s: string | null | undefined): string {
  if (!s) return 'open';
  const lower = String(s).trim().toLowerCase();
  if (lower === 'resolved') return 'closed';
  return lower;
}

export function sanitizeSearchTerm(q: string): string {
  if (!q) return '';
  return q.replace(/[,()*%\\"]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function resolveActingUserId(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  userId?: string | null
): Promise<string | null> {
  if (userId) return userId;
  const { data: acc } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  if (acc?.owner_user_id) return acc.owner_user_id;

  const { data: prof } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle();
  return prof?.user_id || null;
}

export async function findAccountStage(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  stageId: string
): Promise<{ id: string; pipeline_id: string; name: string } | null> {
  const { data, error } = await db
    .from('pipeline_stages')
    .select('id, pipeline_id, name, pipelines!inner(id, account_id)')
    .eq('id', stageId)
    .eq('pipelines.account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as any;
}

export async function applyContactTags(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  names: string[],
  actingUserId?: string | null
) {
  if (!Array.isArray(names) || names.length === 0) return;

  const { data: existingTags } = await db
    .from('tags')
    .select('id, name')
    .eq('account_id', accountId);

  const tagMap = new Map<string, string>();
  for (const t of (existingTags || [])) {
    if (t?.name) tagMap.set(t.name.toLowerCase(), t.id);
  }

  for (const rawName of names) {
    const cleanName = String(rawName || '').trim();
    if (!cleanName) continue;

    let tagId = tagMap.get(cleanName.toLowerCase());
    if (!tagId) {
      const { data: newTag, error: tagErr } = await db
        .from('tags')
        .insert({
          account_id: accountId,
          user_id: actingUserId || null,
          name: cleanName,
          color: '#6366f1',
        })
        .select('id, name')
        .single();
      if (!tagErr && newTag?.id) {
        tagId = newTag.id;
        tagMap.set(cleanName.toLowerCase(), tagId as string);
      }
    }

    if (tagId) {
      await db
        .from('contact_tags')
        .upsert(
          { contact_id: contactId, tag_id: tagId },
          { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
        );
    }
  }
}

export async function applyContactCustomFields(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  values: Record<string, any>
): Promise<string[]> {
  if (!values || typeof values !== 'object') return [];

  const { data: accountFields } = await db
    .from('custom_fields')
    .select('id, field_name')
    .eq('account_id', accountId);

  const fieldMap = new Map<string, string>();
  for (const f of (accountFields || [])) {
    if (f?.field_name) fieldMap.set(f.field_name.toLowerCase(), f.id);
  }

  const skipped: string[] = [];

  for (const [key, val] of Object.entries(values)) {
    const fieldId = fieldMap.get(key.toLowerCase());
    if (!fieldId) {
      skipped.push(key);
      continue;
    }

    const strVal = val === null || val === undefined ? null : String(val);
    await db
      .from('contact_custom_values')
      .upsert(
        { contact_id: contactId, custom_field_id: fieldId, value: strVal },
        { onConflict: 'contact_id,custom_field_id' }
      );
  }

  return skipped;
}

/**
 * Executes an MCP tool call for an authenticated account.
 */
export async function executeMCPTool(
  accountId: string,
  userId: string | undefined,
  call: MCPToolCallParams
): Promise<MCPToolResult> {
  const db = supabaseAdmin();
  const actingUserId = userId || (await resolveActingUserId(db, accountId, userId)) || '';
  const ctx: McpContext = {
    db,
    accountId,
    userId: actingUserId,
    userName: 'Internal User',
    role: 'admin',
    scopes: ['all'],
    keyId: null,
    keyName: 'internal',
    legacyKey: false,
    audit: {},
  };
  return callTool(ctx, call.name, call.arguments || {});
}
