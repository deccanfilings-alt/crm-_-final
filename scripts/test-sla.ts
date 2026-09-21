import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runTest() {
  console.log("Setting up SLA test...");
  
  const { data: convs } = await supabase
    .from('conversations')
    .select('*')
    .limit(1);
    
  if (!convs || convs.length === 0) {
    console.log("No conversations found to test with.");
    return;
  }
  
  const testConv = convs[0];
  console.log(`Using conversation: ${testConv.id}`);
  
  const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  
  await supabase
    .from('conversations')
    .update({
      status: 'open',
      assigned_agent_id: '11111111-1111-1111-1111-111111111111', 
      assigned_at: twentyMinsAgo
    })
    .eq('id', testConv.id);
    
  console.log("Forced conversation to be SLA-breached (assigned 20 mins ago).");
  
  console.log("Triggering SLA Monitor Cron via localhost:3000...");
  const res = await fetch("http://localhost:3000/api/cron/sla-monitor");
  const data = await res.json();
  console.log("Cron Response:", data);
  
  const { data: updatedConv } = await supabase
    .from('conversations')
    .select('assigned_agent_id, assigned_at')
    .eq('id', testConv.id)
    .single();
    
  console.log("Post-cron Conversation State:", updatedConv);
  
  if (updatedConv?.assigned_agent_id === null) {
    console.log("✅ SUCCESS: Conversation was successfully unassigned.");
  } else {
    console.log("❌ FAILED: Conversation is still assigned.");
  }
  
  const { data: latestMsg } = await supabase
    .from('messages')
    .select('content_text, is_internal')
    .eq('conversation_id', testConv.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
    
  console.log("Latest Message in Conversation:", latestMsg);
  if (latestMsg?.is_internal && latestMsg.content_text.includes('@all')) {
    console.log("✅ SUCCESS: Internal SLA note with @all was successfully inserted.");
  } else {
    console.log("❌ FAILED: Internal SLA note missing or incorrect.");
  }
}

runTest().catch(console.error);
