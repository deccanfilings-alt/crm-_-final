import type { MCPToolDefinition } from './types';
import type { McpContext, Role } from './context';
import type { Scope } from './scopes';

import { contactTools } from './tools/contacts';
import { conversationTools } from './tools/conversations';
import { dealTools } from './tools/deals';
import { kbTools } from './tools/kb';
import { taskTools } from './tools/tasks';
import { templateTools } from './tools/templates';
import { teamTools } from './tools/team';
import { billingTools } from './tools/billing';
import { broadcastTools } from './tools/broadcasts';
import { overviewTools } from './tools/overview';
import { teamChatTools } from './tools/team-chat';
import { hygieneTools } from './tools/hygiene';

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: MCPToolDefinition['inputSchema'];
  scope: Scope;
  minRole: Role;
  kind: 'read' | 'write' | 'send';
  idempotent?: boolean;
  handler(ctx: McpContext, args: Record<string, any>): Promise<unknown>;
}

export const MCP_TOOLS: McpTool[] = [
  ...contactTools,
  ...conversationTools,
  ...dealTools,
  ...kbTools,
  ...taskTools,
  ...templateTools,
  ...teamTools,
  ...billingTools,
  ...broadcastTools,
  ...overviewTools,
  ...teamChatTools,
  ...hygieneTools,
];

const toolMap = new Map<string, McpTool>(MCP_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): McpTool | undefined {
  return toolMap.get(name);
}

