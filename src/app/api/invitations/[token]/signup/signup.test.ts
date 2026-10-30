import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: vi.fn(),
}));

describe('Invitation Signup API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects passwords shorter than 8 characters', async () => {
    const req = new Request('http://localhost/api/invitations/tok-123/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@test.com', password: '123', full_name: 'Test' }),
    });

    const res = await POST(req, { params: Promise.resolve({ token: 'tok-123' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('at least 8 characters');
  });

  it('returns 404 for unknown invites', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as any).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: { ok: false, reason: 'not_found' }, error: null }),
    });

    const req = new Request('http://localhost/api/invitations/bad-tok/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@test.com', password: 'password123', full_name: 'Test' }),
    });

    const res = await POST(req, { params: Promise.resolve({ token: 'bad-tok' }) });
    expect(res.status).toBe(404);
  });

  it('returns 410 for expired or used invites', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    (createClient as any).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: { ok: false, reason: 'expired' }, error: null }),
    });

    const req = new Request('http://localhost/api/invitations/exp-tok/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@test.com', password: 'password123', full_name: 'Test' }),
    });

    const res = await POST(req, { params: Promise.resolve({ token: 'exp-tok' }) });
    expect(res.status).toBe(410);
  });

  it('creates confirmed user and returns 200 on valid invite', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { supabaseAdmin } = await import('@/lib/flows/admin-client');

    (createClient as any).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: { ok: true, account_name: 'Deccan' }, error: null }),
    });

    const mockCreateUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    (supabaseAdmin as any).mockReturnValue({
      auth: {
        admin: {
          createUser: mockCreateUser,
        },
      },
    });

    const req = new Request('http://localhost/api/invitations/valid-tok/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@test.com', password: 'password123', full_name: 'New Agent' }),
    });

    const res = await POST(req, { params: Promise.resolve({ token: 'valid-tok' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockCreateUser).toHaveBeenCalledWith({
      email: 'new@test.com',
      password: 'password123',
      email_confirm: true,
      user_metadata: { full_name: 'New Agent' },
    });
  });

  it('returns 409 if email already registered', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { supabaseAdmin } = await import('@/lib/flows/admin-client');

    (createClient as any).mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: { ok: true, account_name: 'Deccan' }, error: null }),
    });

    (supabaseAdmin as any).mockReturnValue({
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValue({
            data: null,
            error: new Error('User already registered'),
          }),
        },
      },
    });

    const req = new Request('http://localhost/api/invitations/valid-tok/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'existing@test.com', password: 'password123', full_name: 'Existing Agent' }),
    });

    const res = await POST(req, { params: Promise.resolve({ token: 'valid-tok' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already has an account');
  });
});

