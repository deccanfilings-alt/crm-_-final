import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runTest() {
  const slaThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: overdueConversations, error: fetchError } = await supabaseAdmin
    .from('conversations')
    .select('id, assigned_agent_id')
    .eq('status', 'open')
    .not('assigned_agent_id', 'is', null)
    .lt('assigned_at', slaThreshold);

  if (fetchError) {
    console.error("fetchError:", fetchError);
    return;
  }
  console.log("overdueConversations:", overdueConversations);

  if (!overdueConversations || overdueConversations.length === 0) {
    return;
  }

  const conversationIds = overdueConversations.map(c => c.id);

  const { error: updateError } = await supabaseAdmin
    .from('conversations')
    .update({
      assigned_agent_id: null,
      assigned_at: null,
    })
    .in('id', conversationIds);

  if (updateError) {
    console.error("updateError:", updateError);
    return;
  }

  const notesToInsert = overdueConversations.map(conv => ({
    conversation_id: conv.id,
    sender_type: 'bot',
    content_type: 'text',
    content_text: `[SLA BREACH] Conversation was automatically unassigned because the agent did not reply within 15 minutes. @all`,
    is_internal: true,
    status: 'sent',
  }));

  const { error: notesError } = await supabaseAdmin
    .from('messages')
    .insert(notesToInsert);

  if (notesError) {
    console.error('Failed to insert SLA notes:', notesError);
  } else {
    console.log("SLA note inserted successfully!");
  }
}

runTest().catch(console.error);
