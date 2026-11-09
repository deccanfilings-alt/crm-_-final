import { NextResponse } from 'next/server';
import { authenticateAgentRequest } from '@/lib/auth/agent-auth';
import { buildContext, McpAuthError, type McpContext } from '@/lib/mcp/context';
import { MCP_TOOLS } from '@/lib/mcp/registry';
import { whyDenied } from '@/lib/mcp/permissions';
import { callTool } from '@/lib/mcp/dispatch';
import { JsonRpcError } from '@/lib/mcp/format';
import type { JSONRPCRequest, JSONRPCResponse } from '@/lib/mcp/types';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(req: Request) {
  const auth = await authenticateAgentRequest(req);

  // Check if client is requesting Server-Sent Events (SSE)
  const acceptHeader = req.headers.get('accept') || '';
  if (acceptHeader.includes('text/event-stream')) {
    return new NextResponse(null, {
      status: 405,
      headers: {
        ...CORS_HEADERS,
        Allow: 'GET, POST',
      },
    });
  }

  let context: McpContext | null = null;
  if (auth.success) {
    try {
      context = await buildContext(auth);
    } catch {
      // Ignore probe context build failure
    }
  }

  // Standard JSON status & health probe (allows Claude.ai connector check to succeed)
  return NextResponse.json(
    {
      name: 'wacrm-mcp',
      version: '2.0.0',
      description: 'WACRM Model Context Protocol (MCP) Server for Claude & Agentic Platforms',
      status: 'ready',
      authenticated: auth.success,
      account_id: auth.account_id || null,
      key_name: auth.key_name || null,
      acting_as: context ? { name: context.userName, role: context.role } : null,
      scopes: context ? context.scopes : (auth.scopes || null),
      warning: context?.legacyKey
        ? 'This key is read-only because it has no owner. Create a new key in Settings → API keys.'
        : undefined,
      tools_count: MCP_TOOLS.length,
    },
    { headers: CORS_HEADERS }
  );
}

export async function POST(req: Request) {
  const auth = await authenticateAgentRequest(req);
  if (!auth.success) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: auth.error || 'Unauthorized' },
      },
      { status: auth.status || 401, headers: CORS_HEADERS }
    );
  }

  let ctx: McpContext;
  try {
    ctx = await buildContext(auth);
  } catch (err: any) {
    const status = err instanceof McpAuthError ? err.status : 403;
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: status === 401 ? -32000 : -32003, message: err?.message || 'Forbidden' },
      },
      { status, headers: CORS_HEADERS }
    );
  }

  try {
    const body: JSONRPCRequest | JSONRPCRequest[] = await req.json();

    if (!Array.isArray(body) && body.method && body.method.startsWith('notifications/')) {
      return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
    }

    // Handle single or batch requests
    if (Array.isArray(body)) {
      const results = await Promise.all(body.map((r) => handleJsonRpcMessage(ctx, r)));
      return NextResponse.json(results.filter(Boolean), { headers: CORS_HEADERS });
    }

    const response = await handleJsonRpcMessage(ctx, body);
    if (!response) {
      // Notification without response
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (err: any) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err?.message || 'Invalid JSON'}` },
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}

async function handleJsonRpcMessage(
  ctx: McpContext,
  msg: JSONRPCRequest
): Promise<JSONRPCResponse | null> {
  const id = msg.id ?? null;

  try {
    // 1. MCP initialize handshake
    if (msg.method === 'initialize') {
      const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
      const asked = (msg.params as any)?.protocolVersion;
      const protocolVersion = SUPPORTED.includes(asked) ? asked : SUPPORTED[0];

      let instructions = `Deccan Filings CRM: WhatsApp inbox, clients, tasks, quotations, invoices, team chat.
You are acting as ${ctx.userName} (${ctx.role}); you can see and change only what they can.
Times are India time (IST, +05:30). Money is INR.
People: tools that take a person accept a name, an email, an id or "me". If a name matches several people, ask which one.
Clients: use search_contacts or search_crm, then get_contact for the full picture.
Before messaging a client: WhatsApp free text only works within 24 hours of the client's last message; otherwise use send_whatsapp_template with a template from list_whatsapp_templates. Always confirm with the user before sending anything to a client.`;

      if (ctx.legacyKey) {
        instructions += '\nThis key is read-only because it has no owner. Create a new key in Settings → API keys.';
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: 'wacrm-mcp',
            title: 'Deccan Filings CRM',
            version: '2.0.0',
          },
          instructions,
        },
      };
    }

    // 2. Initialized notification from client
    if (msg.method === 'notifications/initialized') {
      return null;
    }

    // 3. MCP ping
    if (msg.method === 'ping') {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };
    }

    // 4. Tools list (filtered by whyDenied)
    if (msg.method === 'tools/list') {
      const allowed = MCP_TOOLS.filter((t) => whyDenied(ctx, t) === null).map((t) => {
        let annotations: Record<string, any>;
        if (t.kind === 'read') {
          annotations = { readOnlyHint: true, openWorldHint: false };
        } else if (t.kind === 'write') {
          annotations = {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: t.idempotent ?? false,
            openWorldHint: false,
          };
        } else {
          annotations = {
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: true,
          };
        }

        return {
          name: t.name,
          title: t.title || t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations,
        };
      });
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: allowed,
        },
      };
    }

    // 5. Tools call
    if (msg.method === 'tools/call') {
      const { name, arguments: toolArgs } = msg.params || {};
      if (!name) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing tool name in params' },
        };
      }

      const result = await callTool(ctx, name, toolArgs || {});

      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    }

    // Unknown method
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${msg.method}`,
      },
    };
  } catch (err: any) {
    if (err instanceof JsonRpcError) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: err.code, message: err.message },
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err?.message || String(err) },
    };
  }
}
