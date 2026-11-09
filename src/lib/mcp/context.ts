import { supabaseAdmin } from '@/lib/flows/admin-client';
import type { AgentAuthResult } from '@/lib/auth/agent-auth';
import { PRESETS } from './scopes';

export type Role = 'viewer' | 'agent' | 'admin' | 'owner';
export const ROLE_RANK: Record<Role, number> = { viewer: 0, agent: 1, admin: 2, owner: 3 };

export class McpAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'McpAuthError';
    this.status = status;
  }
}

export interface McpContext {
  db: ReturnType<typeof supabaseAdmin>;
  accountId: string;
  userId: string; // always set
  userName: string;
  role: Role;
  scopes: string[]; // may be ['all']
  keyId: string | null; // null = browser session
  keyName: string;
  legacyKey: boolean; // key has no creator
  audit: { targetId?: string; sends?: number }; // filled in per call (Task 2)
}

export async function buildContext(auth: AgentAuthResult): Promise<McpContext> {
  if (!auth.success || !auth.account_id) {
    throw new McpAuthError(auth.status || 401, auth.error || 'Unauthorized');
  }

  const db = supabaseAdmin();
  const accountId = auth.account_id;

  // 1. Keys without a creator (old / legacy keys)
  if (auth.legacy_no_creator) {
    const { data: acc } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', accountId)
      .maybeSingle();

    if (!acc?.owner_user_id) {
      throw new McpAuthError(403, 'Account owner could not be resolved for this legacy key.');
    }

    const { data: ownerProfile } = await db
      .from('profiles')
      .select('full_name, account_role')
      .eq('user_id', acc.owner_user_id)
      .eq('account_id', accountId)
      .maybeSingle();

    return {
      db,
      accountId,
      userId: acc.owner_user_id,
      userName: ownerProfile?.full_name || 'Account Owner',
      role: 'owner',
      scopes: [...PRESETS.read_only],
      keyId: auth.key_id ?? null,
      keyName: auth.key_name || 'legacy-key',
      legacyKey: true,
      audit: {},
    };
  }

  // 2. User-associated key or browser session
  if (!auth.user_id) {
    throw new McpAuthError(401, 'Unauthorized: user identity missing');
  }

  const { data: profile, error } = await db
    .from('profiles')
    .select('full_name, account_role')
    .eq('user_id', auth.user_id)
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !profile) {
    if (auth.key_id) {
      throw new McpAuthError(
        403,
        'The person who created this key is no longer in this account. Ask an admin for a new key.'
      );
    }
    throw new McpAuthError(403, 'User profile is not linked to this account.');
  }

  const rawRole = (profile.account_role || 'viewer').toLowerCase() as Role;
  const role: Role = ['viewer', 'agent', 'admin', 'owner'].includes(rawRole) ? rawRole : 'viewer';

  return {
    db,
    accountId,
    userId: auth.user_id,
    userName: profile.full_name || 'User',
    role,
    scopes: auth.scopes || ['all'],
    keyId: auth.key_id ?? null,
    keyName: auth.key_name || (auth.key_id ? 'api-key' : 'session'),
    legacyKey: false,
    audit: {},
  };
}

