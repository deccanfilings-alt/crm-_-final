// GET  /api/billing/quotations/:id/email   defaults for the Send via Email dialog
// POST /api/billing/quotations/:id/email   { to, cc?, subject, message }
// Sends from deccanfilings@gmail.com (SMTP_USER / SMTP_PASS). A draft
// becomes Final; sent_email_at drives the ✓✓ in the list.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, UUID_RE } from "@/lib/billing/api";
import { buildQuotationEmail, defaultQuotationMessage, defaultQuotationSubject } from "@/lib/billing/quotation-email";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { emailConfig, EmailNotConfiguredError, parseEmailList, sendEmail } from "@/lib/email/mailer";

type Params = { params: Promise<{ id: string }> };

async function loadQuote(ctx: Awaited<ReturnType<typeof requireRole>>, id: string) {
  return ctx.supabase
    .from("quotations")
    .select("id, quote_number, status, total_amount, valid_until, public_token, client_name, client_email, company_name, billed_to, billed_from")
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .is("deleted_at", null)
    .maybeSingle();
}

function publicLink(request: Request, token: string) {
  // Same base as the WhatsApp send, else this request's origin.
  const base = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  return `${base}/quote/${token}`;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data: q, error } = await loadQuote(ctx, id);
    if (error) return dbErrorResponse(error, "load the quotation");
    if (!q) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    const company = q.billed_from?.name || q.company_name || "Deccan Filings";
    const client = q.billed_to?.contact_name || q.client_name || q.billed_to?.name || "";
    const cfg = emailConfig();
    return NextResponse.json({
      configured: cfg.configured,
      from: cfg.configured ? cfg.user : null,
      to: q.billed_to?.email || q.client_email || "",
      subject: defaultQuotationSubject(q.quote_number, company),
      message: defaultQuotationMessage({ clientName: client, quoteNumber: q.quote_number, companyName: company }),
      link: publicLink(request, q.public_token),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

    if (!emailConfig().configured) {
      return NextResponse.json({ error: new EmailNotConfiguredError().message }, { status: 503 });
    }
    const limit = checkRateLimit(`email:quotation:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const to = parseEmailList(body.to, 5);
    const cc = parseEmailList(body.cc, 5);
    if (!to || !to.length) return NextResponse.json({ error: "Enter a valid email address in To" }, { status: 400 });
    if (!cc) return NextResponse.json({ error: "One of the CC addresses isn't valid" }, { status: 400 });
    const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 200) : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 5000) : "";
    if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    if (!message) return NextResponse.json({ error: "Write a short message" }, { status: 400 });

    const { data: q, error } = await loadQuote(ctx, id);
    if (error) return dbErrorResponse(error, "load the quotation");
    if (!q) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    if (q.status === "cancelled") return NextResponse.json({ error: "This quotation is cancelled" }, { status: 409 });

    const company = q.billed_from?.name || q.company_name || "Deccan Filings";
    const { html, text } = buildQuotationEmail({
      quoteNumber: q.quote_number,
      companyName: company,
      clientName: q.client_name,
      total: Number(q.total_amount) || 0,
      validUntil: q.valid_until,
      link: publicLink(request, q.public_token),
      message,
    });

    try {
      await sendEmail({ to, cc, subject, html, text, fromName: company });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[billing/quotations/email] send failed:", msg);
      const auth = /invalid login|username and password|535/i.test(msg);
      return NextResponse.json(
        {
          error: auth
            ? "Gmail rejected the login. Check SMTP_USER and that SMTP_PASS is a valid Google App Password."
            : "The email couldn't be sent. Please try again in a minute.",
        },
        { status: 502 },
      );
    }

    const now = new Date().toISOString();
    const { error: updErr } = await ctx.supabase
      .from("quotations")
      .update({ ...(q.status === "draft" ? { status: "final" } : {}), sent_email_at: now, sent_at: now, updated_at: now })
      .eq("id", id)
      .eq("account_id", ctx.accountId);
    if (updErr) console.warn("[billing/quotations/email] sent, but status not updated:", updErr.message);

    return NextResponse.json({ ok: true, to });
  } catch (err) {
    return toErrorResponse(err);
  }
}
