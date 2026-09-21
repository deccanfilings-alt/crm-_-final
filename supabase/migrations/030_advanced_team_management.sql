-- Create agent status enum
CREATE TYPE agent_status AS ENUM ('online', 'away', 'offline');

-- Add columns to profiles
ALTER TABLE public.profiles 
ADD COLUMN agent_status agent_status NOT NULL DEFAULT 'online',
ADD COLUMN last_routed_at TIMESTAMPTZ;

-- Add column to conversations
ALTER TABLE public.conversations
ADD COLUMN assigned_at TIMESTAMPTZ;

-- Add internal notes flag to messages
ALTER TABLE public.messages
ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT false;

-- Notify postgrest to refresh schema
NOTIFY pgrst, 'reload schema';
