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

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const accountId = '55b1728f-b476-436e-9bee-755ea3959ecc';

async function main() {
  const stampBuffer = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'branding', 'tor-stamp.png'));
  const sigBuffer = fs.readFileSync(path.resolve(__dirname, '..', 'public', 'branding', 't-reddy-signature.png'));

  const stampPath = `account-${accountId}/${Date.now()}-tor-stamp.png`;
  const sigPath = `account-${accountId}/${Date.now()}-t-reddy-signature.png`;

  console.log("Uploading stamp to chat-media bucket...");
  const { error: stampErr } = await supabase.storage.from('chat-media').upload(stampPath, stampBuffer, {
    contentType: 'image/png',
    upsert: true
  });
  if (stampErr) throw stampErr;

  console.log("Uploading signature to chat-media bucket...");
  const { error: sigErr } = await supabase.storage.from('chat-media').upload(sigPath, sigBuffer, {
    contentType: 'image/png',
    upsert: true
  });
  if (sigErr) throw sigErr;

  const { data: stampUrlData } = supabase.storage.from('chat-media').getPublicUrl(stampPath);
  const { data: sigUrlData } = supabase.storage.from('chat-media').getPublicUrl(sigPath);

  const stampUrl = stampUrlData.publicUrl;
  const signatureUrl = sigUrlData.publicUrl;

  console.log("Stamp URL:", stampUrl);
  console.log("Signature URL:", signatureUrl);

  console.log("Updating quotation_settings...");
  const { error: settingsErr } = await supabase
    .from('quotation_settings')
    .update({
      stamp_url: stampUrl,
      signature_url: signatureUrl,
      updated_at: new Date().toISOString()
    })
    .eq('account_id', accountId);

  if (settingsErr) throw settingsErr;

  console.log("Updating existing quotations...");
  const { error: quoteErr } = await supabase
    .from('quotations')
    .update({
      stamp_url: stampUrl,
      signature_url: signatureUrl
    })
    .eq('account_id', accountId);

  if (quoteErr) console.warn("Quote update warning:", quoteErr.message);

  console.log("Updating existing invoices...");
  const { error: invErr } = await supabase
    .from('invoices')
    .update({
      stamp_url: stampUrl,
      signature_url: signatureUrl
    })
    .eq('account_id', accountId);

  if (invErr) console.warn("Invoice update warning:", invErr.message);

  console.log("SUCCESS! Stamp and signature updated everywhere.");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});

