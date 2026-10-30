export const SCOPES = [
  'contacts:read',
  'contacts:write',
  'conversations:read',
  'notes:write',
  'messages:send',
  'deals:read',
  'deals:write',
  'kb:read',
  'tasks:read',
  'tasks:write',
  'team:read',
  'billing:read',
  'templates:read',
  'broadcasts:read',
  'team_chat:read',
  'team_chat:write',
  'reports:read',
] as const;

export type Scope = (typeof SCOPES)[number];

const READ = SCOPES.filter((s) => s.endsWith(':read'));

export const PRESETS = {
  read_only: READ,
  assistant: [...READ, 'contacts:write', 'notes:write', 'deals:write', 'tasks:write', 'team_chat:write'],
  full: [...SCOPES], // adds messages:send
} satisfies Record<string, Scope[]>;

