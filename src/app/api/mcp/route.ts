import { NextResponse } from 'next/server';
import { authenticateAgentRequest } from '@/lib/auth/agent-auth';
import { WACRM_MCP_TOOLS } from '@/lib/mcp/tools';
import { executeMCPTool } from '@/lib/mcp/handlers';
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
  if (!auth.success) {
    return NextResponse.json(
      { error: auth.error || 'Unauthorized' },
      { status: auth.status || 401, headers: CORS_HEADERS }
    );
  }

  // Check if client is requesting Server-Sent Events (SSE)
  const acceptHeader = req.headers.get('accept') || '';
  if (acceptHeader.includes('text/event-stream')) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send initial SSE connection message
        const welcome = JSON.stringify({
          type: 'connected',
          server: 'wacrm-mcp',
          version: '1.0.0',
          account_id: auth.account_id,
        });
        controller.enqueue(encoder.encode(`event: message\ndata: ${welcome}\n\n`));
      },
    });

    return new Response(stream, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  // Standard JSON status
  return NextResponse.json(
    {
      name: 'wacrm-mcp',
      version: '1.0.0',
      description: 'WACRM Model Context Protocol (MCP) Server for Claude Code & Agentic Platforms',
      status: 'ready',
      account_id: auth.account_id,
      key_name: auth.key_name,
      tools_count: WACRM_MCP_TOOLS.length,
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

  try {
    const body: JSONRPCRequest | JSONRPCRequest[] = await req.json();

    // Handle single or batch requests
    if (Array.isArray(body)) {
      const results = await Promise.all(
        body.map((r) => handleJsonRpcMessage(auth.account_id!, auth.user_id, r))
      );
      return NextResponse.json(results.filter(Boolean), { headers: CORS_HEADERS });
    }

    const response = await handleJsonRpcMessage(auth.account_id!, auth.user_id, body);
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
  accountId: string,
  userId: string | undefined,
  msg: JSONRPCRequest
): Promise<JSONRPCResponse | null> {
  const id = msg.id ?? null;

  // 1. MCP initialize handshake
  if (msg.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'wacrm-mcp',
          version: '1.0.0',
        },
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

  // 4. Tools list
  if (msg.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: WACRM_MCP_TOOLS,
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

    const result = await executeMCPTool(accountId, userId, { name, arguments: toolArgs });
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
}
