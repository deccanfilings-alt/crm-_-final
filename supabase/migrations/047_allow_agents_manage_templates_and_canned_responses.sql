-- ============================================================
-- Migration 047: Allow agents (Team Members) to manage message_templates and canned_responses
--
-- Previously, message_templates and canned_responses were restricted to
-- 'admin' (and 'owner'). This migration grants 'agent' role (Team Members)
-- full permissions to insert, update, and delete message templates and canned
-- responses within their account.
-- ============================================================

-- ---- message_templates -------------------------------------
DROP POLICY IF EXISTS message_templates_insert ON message_templates;
DROP POLICY IF EXISTS message_templates_update ON message_templates;
DROP POLICY IF EXISTS message_templates_delete ON message_templates;

CREATE POLICY message_templates_insert ON message_templates
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY message_templates_update ON message_templates
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

CREATE POLICY message_templates_delete ON message_templates
  FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- canned_responses --------------------------------------
DROP POLICY IF EXISTS "Admins can manage canned responses in their account" ON canned_responses;
DROP POLICY IF EXISTS "Admins can update canned responses in their account" ON canned_responses;
DROP POLICY IF EXISTS "Admins can delete canned responses in their account" ON canned_responses;
DROP POLICY IF EXISTS "Members can insert canned responses in their account" ON canned_responses;
DROP POLICY IF EXISTS "Members can update canned responses in their account" ON canned_responses;
DROP POLICY IF EXISTS "Members can delete canned responses in their account" ON canned_responses;

CREATE POLICY "Members can insert canned responses in their account" ON canned_responses
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY "Members can update canned responses in their account" ON canned_responses
  FOR UPDATE USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

CREATE POLICY "Members can delete canned responses in their account" ON canned_responses
  FOR DELETE USING (is_account_member(account_id, 'agent'));
