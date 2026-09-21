-- ============================================================
-- 035_omnichannel_support.sql — Omnichannel support (Instagram & Facebook)
--
-- Extends the CRM to support multi-channel messaging:
-- 1. Creates `channel_connections` table to store connected Facebook Pages
--    and Instagram Professional accounts per account tenant.
-- 2. Adds `channel` column to `conversations` ('whatsapp', 'instagram', 'facebook').
-- 3. Adds social IDs (`instagram_id`, `instagram_username`, `facebook_psid`) to `contacts`
--    and relaxes the NOT NULL constraint on `phone` for social-first leads.
-- ============================================================

-- ============================================================
-- 1. CHANNEL CONNECTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS channel_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('instagram', 'facebook')),
  page_id TEXT NOT NULL,
  page_name TEXT,
  instagram_business_id TEXT,
  instagram_username TEXT,
  access_token TEXT NOT NULL,
  verify_token TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'expired')),
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, channel_type, page_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_connections_account_id ON channel_connections(account_id);
CREATE INDEX IF NOT EXISTS idx_channel_connections_page_id ON channel_connections(page_id);
CREATE INDEX IF NOT EXISTS idx_channel_connections_ig_id ON channel_connections(instagram_business_id);

ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Account members can read channel connections" ON channel_connections;
CREATE POLICY "Account members can read channel connections" ON channel_connections
  FOR SELECT USING (is_account_member(account_id, 'viewer'));

DROP POLICY IF EXISTS "Account admins can manage channel connections" ON channel_connections;
CREATE POLICY "Account admins can manage channel connections" ON channel_connections
  FOR ALL USING (is_account_member(account_id, 'admin'));

-- Service role bypass
DROP POLICY IF EXISTS "Service role has full access to channel connections" ON channel_connections;
CREATE POLICY "Service role has full access to channel connections" ON channel_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 2. CONVERSATIONS EXTENSIONS
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'instagram', 'facebook')),
  ADD COLUMN IF NOT EXISTS external_thread_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel);
CREATE INDEX IF NOT EXISTS idx_conversations_account_channel ON conversations(account_id, channel);

-- ============================================================
-- 3. CONTACTS SOCIAL IDENTITY EXTENSIONS
-- ============================================================
-- Allow social leads who have not provided a phone number yet
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS instagram_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_username TEXT,
  ADD COLUMN IF NOT EXISTS facebook_psid TEXT;

CREATE INDEX IF NOT EXISTS idx_contacts_instagram_id ON contacts(instagram_id);
CREATE INDEX IF NOT EXISTS idx_contacts_facebook_psid ON contacts(facebook_psid);
CREATE INDEX IF NOT EXISTS idx_contacts_instagram_username ON contacts(instagram_username);
