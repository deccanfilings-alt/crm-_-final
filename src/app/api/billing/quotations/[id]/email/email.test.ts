import { beforeEach, describe, expect, it, vi } from "vitest";

const QID = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({
  configured: true,
  sendError: null as null | Error,
  sent: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  quote: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));

vi.mock("@/lib/email/mailer", async (orig) => {
  const real = await orig<typeof import("@/lib/email/mailer")>();
  return {
    ...real,
    emailConfig: () => ({ configured: state.configured, user: "deccanfilings@gmail.com", pass: "x", host: "smtp.gmail.com", port: 465 }),
    sendEmail: vi.fn(async (m: Record<string, unknown>) => {
      if (state.sendError) throw state.sendError;
      state.sent.push(m);
      return { messageId: "1" };
    }),
  };
});

vi.mock("@/lib/auth/account", async () => {
  const { NextResponse } = await import("next/server");
  const chain = () => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: () => q,
      is: () => q,
      maybeSingle: async () => ({ data: state.quote, error: null }),
      update: (u: Record<string, unknown>) => (state.updates.push(u), q),
      then: (r: (v: unknown) => void) => r({ error: null }),
    });
    return q;
  };
  return {
    requireRole: async () => ({ userId: "me", accountId: "acc-1", role: "agent", supabase: { from: chain } }),
    toErrorResponse: (e: { status?: number; message?: string }) => NextResponse.json({ error: e.message }, { status: e.status ?? 500 }),
  };
});

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ id: QID }) };
const post = (b: unknown) => POST(new Request("http://crm.test/x", { method: "POST", body: JSON.stringify(b) }), params);
const good = { to: "client@acme.in", subject: "Quotation DF-QT-1027", message: "Please see attached." };

beforeEach(() => {
  state.configured = true;
  state.sendError = null;
  state.sent = [];
  state.updates = [];
  state.quote = {
    id: QID, quote_number: "DF-QT-1027", status: "draft", total_amount: 3332, valid_until: null, public_token: "abc123",
    client_name: "Ali", client_email: "ali@acme.in", company_name: "Deccan Filings", billed_to: null, billed_from: { name: "Deccan Filings" },
  };
});

describe("quotation email route", () => {
  it("GET prefills To, subject, message and the public link", async () => {
    const json = await (await GET(new Request("http://crm.test/x"), params)).json();
    expect(json).toMatchObject({ configured: true, to: "ali@acme.in", subject: "Quotation DF-QT-1027 from Deccan Filings", link: "http://crm.test/quote/abc123" });
    expect(json.message).toContain("Dear Ali");
  });
  it("sends, marks the draft Final and records sent_email_at", async () => {
    const res = await post({ ...good, cc: "boss@df.in" });
    expect(res.status).toBe(200);
    expect(state.sent[0]).toMatchObject({ to: ["client@acme.in"], cc: ["boss@df.in"], fromName: "Deccan Filings" });
    expect(state.updates[0]).toMatchObject({ status: "final", sent_email_at: expect.any(String) });
  });
  it("explains when email isn't set up", async () => {
    state.configured = false;
    const res = await post(good);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/SMTP_USER/);
    expect(state.sent).toHaveLength(0);
  });
  it("validates addresses and content", async () => {
    expect((await post({ ...good, to: "nope" })).status).toBe(400);
    expect((await post({ ...good, cc: "bad" })).status).toBe(400);
    expect((await post({ ...good, subject: " " })).status).toBe(400);
    expect(state.sent).toHaveLength(0);
  });
  it("Gmail login failure gives a clear message and doesn't mark it sent", async () => {
    state.sendError = new Error("Invalid login: 535-5.7.8 Username and Password not accepted");
    const res = await post(good);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/App Password/);
    expect(state.updates).toHaveLength(0);
  });
  it("refuses cancelled quotations", async () => {
    state.quote = { ...state.quote, status: "cancelled" };
    expect((await post(good)).status).toBe(409);
  });
});
