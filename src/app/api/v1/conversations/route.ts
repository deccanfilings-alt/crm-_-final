import { NextResponse } from 'next/server';
import { authenticateAgentRequest } from '@/lib/auth/agent-auth';
import { executeMCPTool } from '@/lib/mcp/handlers';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: Request) {
  const auth = await authenticateAgentRequest(req);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401, headers: CORS_HEADERS });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || 'open';
  const channel = searchParams.get('channel') || 'all';
  const limit = Number(searchParams.get('limit')) || 20;

  const result = await executeMCPTool(auth.account_id!, auth.user_id, {
    name: 'list_conversations',
    arguments: { status, channel, limit },
  });

  const parsed = JSON.parse(result.content[0]?.text || '{}');
  if (result.isError) {
    return NextResponse.json(parsed, { status: 400, headers: CORS_HEADERS });
  }

  return NextResponse.json(parsed, { headers: CORS_HEADERS });
}
