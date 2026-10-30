import { getTool } from './registry';
import { whyDenied } from './permissions';
import { JsonRpcError, McpUserError, errorResult, toResult, messageOf } from './format';
import type { McpContext } from './context';
import type { MCPToolResult } from './types';

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
  try {
    const payload = await tool.handler(ctx, args);
    return toResult(payload);
  } catch (err) {
    if (err instanceof JsonRpcError) throw err;
    return err instanceof McpUserError
      ? errorResult(err.message, err.details)
      : errorResult(messageOf(err));
  }
}
