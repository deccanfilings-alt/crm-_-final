import { createHash, randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { createClient } from '@/lib/supabase/server';

export interface AgentAuthResult {
  success: boolean;
  account_id?: string;
  user_id?: string;
  key_id?: string;
  key_name?: string;
  scopes?: string[];
  legacy_no_creator?: boolean;
  status?: number;
  error?: string;
}

/**
 * Hashes a raw API key using SHA-256 for secure storage and comparison.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Generates a new live WACRM API key for agentic clients (Claude Code, Codex, etc.).
 * Returns the raw key (which must be presented to the user once) along with metadata.
 */
export async function generateApiKey({
  accountId,
  userId,
  name,
  scopes = ['all'],
  expiresInDays,
}: {
  accountId: string;
  userId?: string;
  name: string;
  scopes?: string[];
  expiresInDays?: number;
}): Promise<{ rawKey: string; id: string; name: string; key_prefix: string; scopes: string[] }> {
  const secretBytes = randomBytes(24).toString('hex');
  const rawKey = `wacrm_live_${secretBytes}`;
  const key_hash = hashApiKey(rawKey);
  const key_prefix = rawKey.substring(0, 15) + '...';

  let expires_at: string | null = null;
  if (expiresInDays && expiresInDays > 0) {
    const exp = new Date();
    exp.setDate(exp.getDate() + expiresInDays);
    expires_at = exp.toISOString();
  }

  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .insert({
      account_id: accountId,
      created_by: userId || null,
      name,
      key_prefix,
      key_hash,
      scopes,
      expires_at,
      is_active: true,
    })
    .select('id, name, key_prefix, scopes')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to generate API key');
  }

  return {
    rawKey,
    id: data.id,
    name: data.name,
    key_prefix: data.key_prefix,
    scopes: data.scopes,
  };
}

/**
 * Authenticates an incoming request from either:
 * 1. Bearer Token (Claude Code, Codex, Cursor, external agentic platform)
 * 2. User browser session cookies (fallback for in-app UI testing)
 */
export async function authenticateAgentRequest(
  request: Request
): Promise<AgentAuthResult> {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization');

  // 1. Check Bearer Token
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.substring(7).trim();

    if (!token) {
      return { success: false, status: 401, error: 'Empty Bearer token' };
    }

    const hashed = hashApiKey(token);

    const { data: keyRecord, error } = await supabaseAdmin()
      .from('api_keys')
      .select('id, account_id, name, scopes, is_active, expires_at, created_by')
      .eq('key_hash', hashed)
      .maybeSingle();

    if (error || !keyRecord) {
      return { success: false, status: 401, error: 'Invalid or revoked API key' };
    }

    if (!keyRecord.is_active) {
      return { success: false, status: 403, error: 'API key is deactivated' };
    }

    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return { success: false, status: 401, error: 'API key has expired' };
    }

    // Update last_used_at asynchronously (non-blocking)
    void supabaseAdmin()
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRecord.id)
      .then();

    return {
      success: true,
      account_id: keyRecord.account_id,
      user_id: keyRecord.created_by ?? undefined,
      key_id: keyRecord.id,
      key_name: keyRecord.name,
      scopes: keyRecord.scopes || ['all'],
      legacy_no_creator: !keyRecord.created_by,
    };
  }

  // 2. Fallback: Browser session cookies
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (!authError && user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profile?.account_id) {
        return {
          success: true,
          account_id: profile.account_id,
          user_id: user.id,
          scopes: ['all'],
          key_name: 'session',
          legacy_no_creator: false,
        };
      }
    }
  } catch {
    // Session check failed, fall through to unauthorized
  }

  return {
    success: false,
    status: 401,
    error: 'Unauthorized. Provide Authorization: Bearer <wacrm_api_key>',
  };
}

/**
 * Checks if a requested scope is permitted by the token's granted scopes.
 */
export function hasScope(grantedScopes: string[] | undefined, requiredScope: string): boolean {
  if (!grantedScopes || grantedScopes.length === 0) return false;
  if (grantedScopes.includes('all')) return true;
  return grantedScopes.includes(requiredScope);
}
