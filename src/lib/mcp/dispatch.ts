import { getTool, type McpTool } from './registry';
import { whyDenied } from './permissions';
import { JsonRpcError, McpUserError, errorResult, toResult, messageOf } from './format';
import type { McpContext } from './context';
import type { MCPToolResult } from './types';

export function shortenArgs(args: Record<string, any> | undefined | null): Record<string, any> {
  if (!args || typeof args !== 'object') return {};
  const shortened: Record<string, any> = {};
  for (const [key, val] of Object.entries(args)) {
    if (val === null || val === undefined) continue;
    if (typeof val === 'string') {
      shortened[key] = val.length > 300 ? val.substring(0, 300) + '...' : val;
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      shortened[key] = shortenArgs(val);
    } else {
      shortened[key] = val;
    }
  }
  return shortened;
}

export async function logCall(
  ctx: McpContext,
  tool: { name: string },
  args: Record<string, any>,
  result: { ok: boolean; error?: string; ms: number }
): Promise<void> {
  try {
    await ctx.db.from('mcp_tool_calls').insert({
      account_id: ctx.accountId,
      api_key_id: ctx.keyId,
      user_id: ctx.userId,
      tool: tool.name,
      args: shortenArgs(args),
      target_id: ctx.audit.targetId ?? null,
      ok: result.ok,
      error: result.error ?? null,
      sends: ctx.audit.sends ?? 0,
      duration_ms: result.ms,
    });
  } catch (logErr) {
    console.error('[mcp-log] failed to record tool call:', logErr);
  }
}

export async function assertSendAllowed(
  ctx: McpContext,
  tool: McpTool,
  args: Record<string, any>
): Promise<void> {
  const MCP_SEND_LIMIT_HOUR = Number(process.env.MCP_SEND_LIMIT_HOUR) || 20;
  const MCP_SEND_LIMIT_DAY = Number(process.env.MCP_SEND_LIMIT_DAY) || 100;

  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  // 1. Hourly key / user limit
  let hourQuery = ctx.db
    .from('mcp_tool_calls')
    .select('sends')
    .eq('account_id', ctx.accountId)
    .gt('sends', 0)
    .gte('created_at', oneHourAgo);

  if (ctx.keyId) {
    hourQuery = hourQuery.eq('api_key_id', ctx.keyId);
  } else {
    hourQuery = hourQuery.eq('user_id', ctx.userId).is('api_key_id', null);
  }

  const { data: hourRows } = await hourQuery;
  const hourSends = (hourRows || []).reduce((acc: number, r: any) => acc + (Number(r.sends) || 0), 0);

  if (hourSends >= MCP_SEND_LIMIT_HOUR) {
    throw new McpUserError(
      `Send limit reached for this key (${MCP_SEND_LIMIT_HOUR} per hour). Try again later or send from the inbox.`
    );
  }

  // 2. Daily key / user limit
  let dayQuery = ctx.db
    .from('mcp_tool_calls')
    .select('sends')
    .eq('account_id', ctx.accountId)
    .gt('sends', 0)
    .gte('created_at', oneDayAgo);

  if (ctx.keyId) {
    dayQuery = dayQuery.eq('api_key_id', ctx.keyId);
  } else {
    dayQuery = dayQuery.eq('user_id', ctx.userId).is('api_key_id', null);
  }

  const { data: dayRows } = await dayQuery;
  const daySends = (dayRows || []).reduce((acc: number, r: any) => acc + (Number(r.sends) || 0), 0);

  if (daySends >= MCP_SEND_LIMIT_DAY) {
    throw new McpUserError(
      `Send limit reached for this key (${MCP_SEND_LIMIT_DAY} per day). Try again later or send from the inbox.`
    );
  }

  // 3. Per-chat frequency check (at most 3 connector messages in 10 minutes without customer reply)
  const targetConvId = args.conversation_id ? String(args.conversation_id).trim() : null;
  if (targetConvId) {
    const { data: conv } = await ctx.db
      .from('conversations')
      .select('last_customer_message_at')
      .eq('id', targetConvId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
    let sinceTime = tenMinAgo;
    if (conv?.last_customer_message_at && conv.last_customer_message_at > tenMinAgo) {
      sinceTime = conv.last_customer_message_at;
    }

    const { data: recentSends } = await ctx.db
      .from('mcp_tool_calls')
      .select('sends')
      .eq('account_id', ctx.accountId)
      .eq('target_id', targetConvId)
      .gt('sends', 0)
      .gt('created_at', sinceTime);

    const chatSendCount = (recentSends || []).reduce((sum: number, r: any) => sum + (Number(r.sends) || 0), 0);
    if (chatSendCount >= 3) {
      throw new McpUserError(
        'Too many automated messages sent to this conversation in 10 minutes without customer reply. Wait for a reply or send from the inbox.'
      );
    }
  }
}

export async function callTool(
  ctx: McpContext,
  name: string,
  args: Record<string, any>
): Promise<MCPToolResult> {
  const tool = getTool(name);
  if (!tool) throw new JsonRpcError(-32602, `Unknown tool: ${name}`);
  const denied = whyDenied(ctx, tool);
  if (denied) return errorResult(denied);

  ctx.audit = {};
  const started = Date.now();

  try {
    if (tool.kind === 'send') {
      await assertSendAllowed(ctx, tool, args);
    }

    const payload = await tool.handler(ctx, args);
    await logCall(ctx, tool, args, { ok: true, ms: Date.now() - started });
    return toResult(payload);
  } catch (err) {
    if (err instanceof JsonRpcError) throw err;
    await logCall(ctx, tool, args, { ok: false, error: messageOf(err), ms: Date.now() - started });
    return err instanceof McpUserError
      ? errorResult(err.message, err.details)
      : errorResult(messageOf(err));
  }
}
