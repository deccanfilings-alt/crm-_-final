import type { MCPToolResult } from './types';
import type { McpContext } from './context';
import { todayIST } from '@/lib/dates';

export class JsonRpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
  }
}

export class McpUserError extends Error {
  details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'McpUserError';
    this.details = details;
  }
}

export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function toResult(payload: unknown): MCPToolResult {
  let text = JSON.stringify(payload);
  if (text.length > 50000 && payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const obj = { ...(payload as Record<string, any>) };
    let longestKey: string | null = null;
    let maxLen = 0;
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && v.length > maxLen) {
        maxLen = v.length;
        longestKey = k;
      }
    }
    if (longestKey && maxLen > 10) {
      const halved = Math.floor(maxLen / 2);
      obj[longestKey] = obj[longestKey].slice(0, halved);
      obj.truncated = true;
      obj.next_offset = halved;
      text = JSON.stringify(obj);
    }
  }
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

export function errorResult(message: string, details?: Record<string, unknown>): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: message, ...(details || {}) }),
      },
    ],
    isError: true,
  };
}

export function istTime(ts: string | number | Date | null | undefined): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const istDate = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
  const iso = istDate.toISOString();
  return iso.substring(0, 19) + '+05:30';
}

export const istToday = todayIST;

export async function loadNames(
  ctx: McpContext,
  userIds: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const cleanIds = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  const map = new Map<string, string>();
  if (cleanIds.length === 0) return map;
  const { data } = await ctx.db
    .from('profiles')
    .select('id, user_id, full_name')
    .eq('account_id', ctx.accountId)
    .or(`id.in.(${cleanIds.join(',')}),user_id.in.(${cleanIds.join(',')})`);
  for (const row of (data || [])) {
    if (row.id && row.full_name) map.set(row.id, row.full_name);
    if (row.user_id && row.full_name) map.set(row.user_id, row.full_name);
  }
  return map;
}

export function appUrl(): string {
  return process.env.APP_URL || 'https://crm.deccanfilings.com';
}
