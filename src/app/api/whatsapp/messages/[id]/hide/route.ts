import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { canSendMessages, hasMinRole } from '@/lib/auth/roles'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/whatsapp/messages/:id/hide  — "Delete for me"
 * Body: { hidden: boolean }
 *
 * Hides (or unhides) a message in the team inbox only. WhatsApp's Cloud
 * API cannot unsend, so the client keeps the message; we keep the row for
 * audit and admins still see it, marked as hidden.
 *
 *   hide   — agent or above
 *   unhide — admin/owner, or the person who hid it
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getCurrentAccount()
    if (!canSendMessages(ctx.role)) {
      return NextResponse.json({ error: 'Your role is read-only' }, { status: 403 })
    }
    const { id } = await params
    if (!UUID.test(id)) {
      return NextResponse.json({ error: 'Invalid message id' }, { status: 400 })
    }
    const body = (await request.json().catch(() => null)) as { hidden?: unknown } | null
    if (typeof body?.hidden !== 'boolean') {
      return NextResponse.json({ error: 'hidden (boolean) is required' }, { status: 400 })
    }

    // RLS (messages_select) limits this to conversations in the caller's account.
    const { data: msg, error: fetchErr } = await ctx.supabase
      .from('messages')
      .select('id, hidden_at, hidden_by, conversation:conversations!inner(account_id)')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) throw fetchErr
    const conv = msg ? (Array.isArray(msg.conversation) ? msg.conversation[0] : msg.conversation) : null
    if (!msg || (conv as { account_id?: string } | null)?.account_id !== ctx.accountId) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    if (!body.hidden && msg.hidden_at && !hasMinRole(ctx.role, 'admin') && msg.hidden_by !== ctx.userId) {
      return NextResponse.json({ error: 'Only an admin or the person who deleted it can restore this message' }, { status: 403 })
    }

    const patch = body.hidden
      ? { hidden_at: msg.hidden_at ?? new Date().toISOString(), hidden_by: msg.hidden_by ?? ctx.userId }
      : { hidden_at: null, hidden_by: null }

    const { data: updated, error: updErr } = await ctx.supabase
      .from('messages')
      .update(patch)
      .eq('id', id)
      .select('id, hidden_at, hidden_by')
      .single()
    if (updErr) throw updErr

    return NextResponse.json({ message: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
