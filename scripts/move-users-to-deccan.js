const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = match[2] || '';
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    env[match[1]] = val.trim();
  }
}

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = env['SUPABASE_SERVICE_ROLE_KEY'];

const supabase = createClient(supabaseUrl, supabaseKey);
const deccanAccountId = '55b1728f-b476-436e-9bee-755ea3959ecc';

async function main() {
  const emails = ['sgmconnects@gmail.com', 'jash2686@gmail.com'];

  for (const email of emails) {
    console.log(`Checking profile for ${email}...`);
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select('id, user_id, account_id, account_role, full_name')
      .eq('email', email)
      .maybeSingle();

    if (pErr) {
      console.error(`Error fetching profile for ${email}:`, pErr);
      continue;
    }

    if (!profile) {
      console.log(`No profile found for ${email}`);
      continue;
    }

    console.log(`Current profile for ${email}:`, profile);
    const oldAccountId = profile.account_id;

    if (oldAccountId === deccanAccountId) {
      console.log(`${email} is ALREADY in Deccan Filings account.`);
      continue;
    }

    console.log(`Moving ${email} to Deccan Filings account (${deccanAccountId})...`);
    const { error: updateErr } = await supabase
      .from('profiles')
      .update({
        account_id: deccanAccountId,
        account_role: 'admin' // or 'agent'
      })
      .eq('email', email);

    if (updateErr) {
      console.error(`Failed to update profile for ${email}:`, updateErr);
      continue;
    }

    console.log(`Successfully moved ${email} to Deccan Filings.`);

    // If the old account is empty, clean it up
    if (oldAccountId && oldAccountId !== deccanAccountId) {
      console.log(`Checking if old account ${oldAccountId} can be cleaned up...`);
      const { data: contacts } = await supabase.from('contacts').select('id', { count: 'exact' }).eq('account_id', oldAccountId);
      if (!contacts || contacts.length === 0) {
        await supabase.from('accounts').delete().eq('id', oldAccountId);
        console.log(`Cleaned up empty old account ${oldAccountId}`);
      }
    }
  }

  console.log("ALL DONE!");
}

main().catch(console.error);

