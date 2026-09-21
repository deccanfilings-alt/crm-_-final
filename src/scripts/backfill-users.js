const fs = require('fs');
const { createClient } = require('e:/wacrm/node_modules/@supabase/supabase-js');

// Parse .env.local manually
const envPath = 'e:/wacrm/.env.local';
if (!fs.existsSync(envPath)) {
  console.error(".env.local file not found at " + envPath);
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value.trim();
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function backfill() {
  console.log("Starting backfill for existing auth users...");

  // Get auth users
  const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
  if (authError) {
    console.error("Error listing auth users:", authError);
    process.exit(1);
  }

  console.log(`Found ${users.length} auth user(s) in system.`);

  for (const user of users) {
    console.log(`Processing user: ID=${user.id}, Email=${user.email}`);

    // Check if profile exists
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileErr) {
      console.error(`Error checking profile for user ${user.id}:`, profileErr);
      continue;
    }

    if (profile) {
      console.log(`Profile already exists for user ${user.email} (Account ID: ${profile.account_id})`);
      continue;
    }

    console.log(`No profile found for user ${user.email}. Creating profile and account workspace...`);

    // Check if account already exists for this user
    let { data: account, error: accountErr } = await supabase
      .from('accounts')
      .select('*')
      .eq('owner_user_id', user.id)
      .maybeSingle();

    if (accountErr) {
      console.error(`Error checking account for user ${user.id}:`, accountErr);
      continue;
    }

    if (!account) {
      const accountName = user.user_metadata?.full_name 
        ? `${user.user_metadata.full_name}'s Account`
        : `${user.email.split('@')[0]}'s Workspace`;

      console.log(`Creating account workspace "${accountName}"...`);
      const { data: newAccount, error: createAccErr } = await supabase
        .from('accounts')
        .insert({ name: accountName, owner_user_id: user.id })
        .select()
        .single();

      if (createAccErr) {
        console.error("Error creating account:", createAccErr);
        continue;
      }
      account = newAccount;
    }

    console.log(`Creating profile linked to Account ID ${account.id}...`);
    const fullName = user.user_metadata?.full_name || user.email.split('@')[0];
    const { error: createProfErr } = await supabase
      .from('profiles')
      .insert({
        user_id: user.id,
        full_name: fullName,
        email: user.email,
        account_id: account.id,
        account_role: 'owner'
      });

    if (createProfErr) {
      console.error("Error creating profile:", createProfErr);
    } else {
      console.log(`Successfully backfilled account and profile for ${user.email}!`);
    }
  }

  console.log("Backfill complete.");
}

backfill();
