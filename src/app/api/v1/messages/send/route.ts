import { NextResponse } from 'next/server';
import { authenticateAgentRequest } from '@/lib/auth/agent-auth';
import { executeMCPTool } from '@/lib/mcp/handlers';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const auth = await authenticateAgentRequest(req);
  if (!auth.success) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401, headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const result = await executeMCPTool(auth.account_id!, auth.user_id, {
      name: 'send_chat_message',
      arguments: body,
    });

    const parsed = JSON.parse(result.content[0]?.text || '{}');
    if (result.isError) {
      return NextResponse.json(parsed, { status: 400, headers: CORS_HEADERS });
    }

    return NextResponse.json(parsed, { headers: CORS_HEADERS });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Invalid JSON' }, { status: 400, headers: CORS_HEADERS });
  }
}
