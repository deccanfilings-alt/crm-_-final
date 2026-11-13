// ============================================================
// Outgoing email through Gmail SMTP (deccanfilings@gmail.com).
//   SMTP_USER  the Gmail address
//   SMTP_PASS  a Google "App Password" (16 chars, needs 2-Step Verification)
// Optional: SMTP_HOST / SMTP_PORT for a non-Gmail server, SMTP_FROM_NAME.
// Server-only.
// ============================================================

import nodemailer, { type Transporter } from "nodemailer";

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email isn't set up yet — add SMTP_USER and SMTP_PASS (a Gmail App Password) to the environment.");
    this.name = "EmailNotConfiguredError";
  }
}

export function emailConfig() {
  const user = process.env.SMTP_USER?.trim() || "";
  const pass = (process.env.SMTP_PASS || "").replace(/\s+/g, ""); // App Passwords are shown with spaces
  return {
    configured: !!user && !!pass,
    user,
    pass,
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 465,
  };
}

let cached: { key: string; transport: Transporter } | null = null;

function transport(): Transporter {
  const c = emailConfig();
  if (!c.configured) throw new EmailNotConfiguredError();
  const key = `${c.host}:${c.port}:${c.user}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      transport: nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.port === 465,
        auth: { user: c.user, pass: c.pass },
      }),
    };
  }
  return cached.transport;
}

export interface OutgoingEmail {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  /** Shown as the sender name, e.g. "Deccan Filings". */
  fromName?: string;
  replyTo?: string;
}

export async function sendEmail(mail: OutgoingEmail): Promise<{ messageId: string }> {
  const c = emailConfig();
  const t = transport();
  const fromName = (mail.fromName || process.env.SMTP_FROM_NAME || "").replace(/["<>\r\n]/g, "").trim();
  const info = await t.sendMail({
    from: fromName ? `"${fromName}" <${c.user}>` : c.user,
    to: mail.to,
    cc: mail.cc?.length ? mail.cc : undefined,
    replyTo: mail.replyTo || c.user,
    subject: mail.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
    html: mail.html,
    text: mail.text,
  });
  return { messageId: String(info.messageId ?? "") };
}

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** "a@x.com, b@y.com" -> ["a@x.com","b@y.com"]; null if any is invalid. */
export function parseEmailList(v: unknown, max = 10): string[] | null {
  if (v === null || v === undefined || v === "") return [];
  const raw = Array.isArray(v) ? v : String(v).split(/[,;\s]+/);
  const list = raw.map((x) => String(x).trim()).filter(Boolean);
  if (list.length > max) return null;
  return list.every((e) => EMAIL_RE.test(e) && e.length <= 200) ? [...new Set(list.map((e) => e.toLowerCase()))] : null;
}
