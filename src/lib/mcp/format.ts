import type { MCPToolResult } from './types';

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
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
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
