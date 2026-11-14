// GET  /api/billing/invoices/:id/email   defaults for the Send via Email dialog
// POST /api/billing/invoices/:id/email   { to, cc?, subject, message }
// Proforma / tax invoice by email from SMTP_USER. A draft is issued
// (Unpaid); sent_email_at drives the ✓✓ in the list.
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { dbErrorResponse, UUID_RE } from "@/lib/billing/api";
import { buildQuotationEmail, defaultInvoiceMessage } from "@/lib/billing/quotation-email";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { emailConfig, EmailNotConfiguredError, parseEmailList, sendEmail } from "@/lib/email/mailer";

type Params = { params: Promise<{ id: string }> };

async function loadInvoice(ctx: Awaited<ReturnType<typeof requireRole>>, id: string) {
  return ctx.supabase
    .from("invoices")
    .select(
      "id, invoice_number, invoice_type, status, total_amount, paid_amount, balance_amount, due_date, public_token, client_name, client_email, company_name, billed_to, billed_from",
    )
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .is("deleted_at", null)
    .maybeSingle();
}

const labelOf = (t: string): "Tax Invoice" | "Proforma Invoice" => (t === "tax_invoice" ? "Tax Invoice" : "Proforma Invoice");

function publicLink(request: Request, token: string) {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  return `${base}/invoice/${token}`;
}

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    const { data: inv, error } = await loadInvoice(ctx, id);
    if (error) return dbErrorResponse(error, "load the invoice");
    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    const company = inv.billed_from?.name || inv.company_name || "Deccan Filings";
    const client = inv.billed_to?.contact_name || inv.client_name || inv.billed_to?.name || "";
    const label = labelOf(inv.invoice_type);
    const cfg = emailConfig();
    return NextResponse.json({
      configured: cfg.configured,
      from: cfg.configured ? cfg.user : null,
      to: inv.billed_to?.email || inv.client_email || "",
      subject: `${label} ${inv.invoice_number} from ${company}`,
      message: defaultInvoiceMessage({
        clientName: client,
        number: inv.invoice_number,
        companyName: company,
        docLabel: label,
        paid: inv.status === "paid",
      }),
      link: publicLink(request, inv.public_token),
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
    const limit = checkRateLimit(`email:invoice:${ctx.userId}`, RATE_LIMITS.adminAction);
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

    const { data: inv, error } = await loadInvoice(ctx, id);
    if (error) return dbErrorResponse(error, "load the invoice");
    if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    if (inv.status === "cancelled") return NextResponse.json({ error: "This invoice is cancelled" }, { status: 409 });

    const company = inv.billed_from?.name || inv.company_name || "Deccan Filings";
    const { html, text } = buildQuotationEmail({
      docLabel: labelOf(inv.invoice_type),
      quoteNumber: inv.invoice_number,
      companyName: company,
      clientName: inv.client_name,
      total: Number(inv.total_amount) || 0,
      validUntil: null,
      dueDate: inv.due_date,
      balance: Number(inv.balance_amount) || 0,
      link: publicLink(request, inv.public_token),
      message,
    });

    try {
      await sendEmail({ to, cc, subject, html, text, fromName: company });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[billing/invoices/email] send failed:", msg);
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
      .from("invoices")
      .update({ ...(inv.status === "draft" ? { status: "unpaid" } : {}), sent_email_at: now, sent_at: now, updated_at: now })
      .eq("id", id)
      .eq("account_id", ctx.accountId);
    if (updErr) console.warn("[billing/invoices/email] sent, but status not updated:", updErr.message);

    return NextResponse.json({ ok: true, to });
  } catch (err) {
    return toErrorResponse(err);
  }
}
