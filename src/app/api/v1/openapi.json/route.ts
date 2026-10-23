import { NextResponse } from 'next/server';
import { WACRM_MCP_TOOLS } from '@/lib/mcp/tools';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const host = req.headers.get('host') || 'localhost:3000';
  const protocol = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  const serverUrl = `${protocol}://${host}`;

  // Dynamically build OpenAPI paths from MCP tools
  const paths: Record<string, any> = {
    '/api/mcp': {
      post: {
        summary: 'MCP JSON-RPC Endpoint',
        description: 'Model Context Protocol (MCP) JSON-RPC 2.0 endpoint for Claude Code, Cursor, and Agent clients.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  jsonrpc: { type: 'string', example: '2.0' },
                  id: { type: 'string', example: '1' },
                  method: { type: 'string', example: 'tools/call' },
                  params: { type: 'object' },
                },
                required: ['jsonrpc', 'method'],
              },
            },
          },
        },
        responses: {
          200: {
            description: 'JSON-RPC response containing tool result',
          },
        },
      },
    },
    '/api/v1/contacts/search': {
      get: {
        summary: 'Search Contacts',
        description: 'Search contacts across name, phone, email, and company.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'query', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 10 } },
        ],
        responses: { 200: { description: 'List of matching contacts' } },
      },
    },
    '/api/v1/conversations': {
      get: {
        summary: 'List Conversations',
        description: 'Fetch active message threads across WhatsApp, Instagram, and Facebook.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['open', 'pending', 'resolved', 'all'] } },
          { name: 'channel', in: 'query', required: false, schema: { type: 'string', enum: ['whatsapp', 'instagram', 'facebook', 'all'] } },
        ],
        responses: { 200: { description: 'List of conversations' } },
      },
    },
    '/api/v1/messages/send': {
      post: {
        summary: 'Send Message',
        description: 'Send a message or template to a customer thread.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  conversation_id: { type: 'string' },
                  text: { type: 'string' },
                },
                required: ['conversation_id', 'text'],
              },
            },
          },
        },
        responses: { 200: { description: 'Message sent confirmation' } },
      },
    },
    '/api/v1/deals': {
      get: {
        summary: 'List Deals',
        description: 'Retrieve sales pipeline deals.',
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: 'List of deals' } },
      },
      post: {
        summary: 'Create Deal',
        description: 'Create a deal linked to a contact and pipeline stage.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  contact_id: { type: 'string' },
                  title: { type: 'string' },
                  value: { type: 'number' },
                  stage_id: { type: 'string' },
                },
                required: ['contact_id', 'title', 'value', 'stage_id'],
              },
            },
          },
        },
        responses: { 200: { description: 'Created deal' } },
      },
    },
    '/api/v1/knowledge-bases/search': {
      post: {
        summary: 'Search Knowledge Base',
        description: 'Semantic vector / text search against uploaded company knowledge base documents.',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  kb_id: { type: 'string' },
                  limit: { type: 'integer', default: 4 },
                },
                required: ['query'],
              },
            },
          },
        },
        responses: { 200: { description: 'Matching document chunks' } },
      },
    },
  };

  const openApiDoc = {
    openapi: '3.1.0',
    info: {
      title: 'WACRM Agent Connector API',
      version: '1.0.0',
      description: 'Programmatic API and Model Context Protocol (MCP) server for Claude Code, Codex, and Agentic platforms to interact with WACRM.',
    },
    servers: [{ url: serverUrl, description: 'Live Hosted WACRM Instance' }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'wacrm_live_* API Key',
          description: 'Pass your WACRM API key as: Authorization: Bearer wacrm_live_...',
        },
      },
      schemas: {
        MCPToolsCatalog: {
          type: 'object',
          description: 'Catalog of MCP tools natively exposed to Claude Code and AI agents',
          properties: {
            tools: {
              type: 'array',
              items: { type: 'object' },
              example: WACRM_MCP_TOOLS,
            },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    paths,
  };

  return NextResponse.json(openApiDoc, { headers: CORS_HEADERS });
}
