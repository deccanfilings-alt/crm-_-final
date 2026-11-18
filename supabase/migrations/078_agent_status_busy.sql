-- 078: "Busy" availability status.
--
-- Adds 'busy' to the agent_status enum (migration 030). Busy members
-- are working but don't want to be disturbed:
--   - round-robin auto-assignment only picks 'online' members, so
--     busy members get no new chats
--   - team chat @here only pings 'online' members
--
-- Run this before deploying the app version that offers "Busy";
-- otherwise choosing Busy fails with an invalid enum value.
-- ADD VALUE can't be used in the same transaction that adds it, so
-- run it on its own. IF NOT EXISTS makes re-running safe.

ALTER TYPE agent_status ADD VALUE IF NOT EXISTS 'busy' AFTER 'online';
