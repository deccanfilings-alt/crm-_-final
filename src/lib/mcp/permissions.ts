import { ROLE_RANK, type McpContext } from './context';
import type { McpTool } from './registry';
import { hasScope } from '@/lib/auth/agent-auth';

export function whyDenied(ctx: McpContext, tool: McpTool): string | null {
  if (ROLE_RANK[ctx.role] < ROLE_RANK[tool.minRole]) {
    return `Your role (${ctx.role}) can't use ${tool.name}.`;
  }
  if (ctx.role === 'viewer' && tool.kind !== 'read') {
    return 'Viewers have read-only access.';
  }
  if (!hasScope(ctx.scopes, tool.scope)) {
    return `This key doesn't have the "${tool.scope}" permission. An admin can change it in Settings → API keys.`;
  }
  return null;
}
