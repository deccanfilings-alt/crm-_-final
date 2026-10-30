import { NextResponse } from 'next/server';
import { authenticateAgentRequest, hasScope } from '@/lib/auth/agent-auth';
import { buildContext } from '@/lib/mcp/context';
import { assertSendAllowed, logCall } from '@/lib/mcp/dispatch';
import { getTool } from '@/lib/mcp/registry';
import { messageOf, McpUserError } from '@/lib/mcp/format';

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

  if (!hasScope(auth.scopes, 'messages:send')) {
    return NextResponse.json(
      { error: 'Forbidden: Missing required scope "messages:send"' },
      { status: 403, headers: CORS_HEADERS }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Invalid JSON' }, { status: 400, headers: CORS_HEADERS });
  }

  const tool = getTool('send_chat_message');
  if (!tool) {
    return NextResponse.json({ error: 'send_chat_message tool not found' }, { status: 500, headers: CORS_HEADERS });
  }

  const toolRef = { name: 'v1.messages.send' };
  const started = Date.now();
  let ctx;
  try {
    ctx = await buildContext(auth);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Forbidden' }, { status: 403, headers: CORS_HEADERS });
  }

  try {
    await assertSendAllowed(ctx, tool, body);
    const payload: any = await tool.handler(ctx, body);
    await logCall(ctx, toolRef, body, { ok: true, ms: Date.now() - started });
    return NextResponse.json(payload, { headers: CORS_HEADERS });
  } catch (err) {
    const errorMsg = messageOf(err);
    await logCall(ctx, toolRef, body, { ok: false, error: errorMsg, ms: Date.now() - started });
    const status = err instanceof McpUserError ? 429 : 400;
    return NextResponse.json({ error: errorMsg }, { status, headers: CORS_HEADERS });
  }
}
