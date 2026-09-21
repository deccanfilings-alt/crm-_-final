-- Seed file for local Supabase development.
-- Inserts a default testing user into auth.users. The trigger on_auth_user_created
-- will automatically generate their public profile and owner account workspace.

INSERT INTO auth.users (
  id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  role,
  aud
)
VALUES (
  '19f2da37-8dac-4469-b47c-f148f9c48346', -- Fixed UUID for local testing
  'test@example.com',
  crypt('password123', gen_salt('bf')), -- password is: password123
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Test User"}',
  now(),
  now(),
  'authenticated',
  'authenticated'
)
ON CONFLICT (id) DO NOTHING;
