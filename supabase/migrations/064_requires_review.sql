-- 064_requires_review.sql
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS requires_review BOOLEAN DEFAULT false;
