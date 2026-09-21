import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET(request: Request) {
  // Verify Vercel cron secret if deployed
  const authHeader = request.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 15 minutes ago
    const slaThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { data: overdueConversations, error: fetchError } = await supabaseAdmin()
      .from('conversations')
      .select('id, assigned_agent_id')
      .eq('status', 'open')
      .not('assigned_agent_id', 'is', null)
      .lt('assigned_at', slaThreshold);

    if (fetchError) {
      throw fetchError;
    }

    if (!overdueConversations || overdueConversations.length === 0) {
      return NextResponse.json({ success: true, message: 'No overdue conversations.' });
    }

    const conversationIds = overdueConversations.map(c => c.id);

    // Unassign them
    const { error: updateError } = await supabaseAdmin()
      .from('conversations')
      .update({
        assigned_agent_id: null,
        assigned_at: null,
      })
      .in('id', conversationIds);

    if (updateError) {
      throw updateError;
    }

    // Insert an internal note for each unassigned conversation
    const notesToInsert = overdueConversations.map(conv => ({
      conversation_id: conv.id,
      sender_type: 'bot',
      content_type: 'text',
      content_text: `[SLA BREACH] Conversation was automatically unassigned because the agent did not reply within 15 minutes. @all`,
      is_internal: true,
      status: 'sent',
    }));

    const { error: notesError } = await supabaseAdmin()
      .from('messages')
      .insert(notesToInsert);

    if (notesError) {
      console.error('Failed to insert SLA notes:', notesError);
      // Don't fail the whole job if notes fail, since we successfully unassigned.
    }

    return NextResponse.json({
      success: true,
      unassigned_count: overdueConversations.length,
    });
  } catch (error) {
    console.error('SLA Monitor Cron Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
