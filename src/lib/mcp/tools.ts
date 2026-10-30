import { MCP_TOOLS } from './registry';
import type { MCPToolDefinition } from './types';

export const WACRM_MCP_TOOLS: MCPToolDefinition[] = MCP_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));
