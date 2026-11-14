// The email a client receives for a quotation: the message you wrote,
// a summary, and a button to the quotation (where they can view,
// print / save PDF and accept). Pure — builds subject/html/text.

import { escapeHtml as e } from "./quotation-document";

export interface QuotationEmailInput {
  quoteNumber: string;
  companyName: string;
  clientName: string;
  total: number;
  validUntil: string | null;
  link: string;
  message: string;
  /** Defaults to a quotation. Invoices show the due date and balance. */
  docLabel?: "Quotation" | "Proforma Invoice" | "Tax Invoice";
  dueDate?: string | null;
  balance?: number | null;
}

const money = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : null);

export function defaultQuotationSubject(quoteNumber: string, companyName: string): string {
  return `Quotation ${quoteNumber} from ${companyName}`;
}

export function defaultQuotationMessage(i: Pick<QuotationEmailInput, "clientName" | "quoteNumber" | "companyName">): string {
  return `Dear ${i.clientName || "Sir/Madam"},\n\nPlease find our quotation ${i.quoteNumber} below. You can view it, save it as PDF and accept it online using the button.\n\nLet us know if you have any questions.\n\nRegards,\n${i.companyName}`;
}

export function defaultInvoiceMessage(i: { clientName: string; number: string; companyName: string; docLabel: string; paid: boolean }): string {
  const what = i.docLabel.toLowerCase();
  return [
    `Dear ${i.clientName || "Sir/Madam"},`,
    "",
    `Please find our ${what} ${i.number} below. You can view it and save it as PDF using the button.`,
    ...(i.paid ? ["", "Thank you for your payment."] : []),
    "",
    "Let us know if you have any questions.",
    "",
    "Regards,",
    i.companyName,
  ].join("\n");
}

export function buildQuotationEmail(i: QuotationEmailInput): { html: string; text: string } {
  const label = i.docLabel ?? "Quotation";
  const isQuote = label === "Quotation";
  const valid = dmy(i.validUntil);
  const due = dmy(i.dueDate ?? null);
  const balance = i.balance != null && i.balance > 0 ? i.balance : null;
  const text = [
    i.message.trim(),
    "",
    `${label}: ${i.quoteNumber}`,
    `Amount: ${money(i.total)}`,
    balance ? `Amount due: ${money(balance)}` : null,
    valid ? `Valid until: ${valid}` : null,
    due && balance ? `Due date: ${due}` : null,
    "",
    `${isQuote ? "View / download / accept" : "View / download"}: ${i.link}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f3f4f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px">
<tr><td style="padding:24px 28px 8px;font-size:14px;line-height:1.6">${e(i.message.trim()).replace(/\n/g, "<br>")}</td></tr>
<tr><td style="padding:12px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;font-size:14px">
    <tr><td style="padding:10px 14px;color:#6b7280">${e(label)}</td><td style="padding:10px 14px;text-align:right;font-weight:bold">${e(i.quoteNumber)}</td></tr>
    <tr><td style="padding:0 14px 10px;color:#6b7280">Amount</td><td style="padding:0 14px 10px;text-align:right;font-weight:bold">${e(money(i.total))}</td></tr>
    ${balance ? `<tr><td style="padding:0 14px 10px;color:#6b7280">Amount due</td><td style="padding:0 14px 10px;text-align:right;font-weight:bold;color:#b91c1c">${e(money(balance))}</td></tr>` : ""}
    ${valid ? `<tr><td style="padding:0 14px 10px;color:#6b7280">Valid until</td><td style="padding:0 14px 10px;text-align:right">${e(valid)}</td></tr>` : ""}
    ${due && balance ? `<tr><td style="padding:0 14px 10px;color:#6b7280">Due date</td><td style="padding:0 14px 10px;text-align:right">${e(due)}</td></tr>` : ""}
  </table>
</td></tr>
<tr><td align="center" style="padding:12px 28px 24px">
  <a href="${e(i.link)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:6px">View ${e(label.toLowerCase())}</a>
  <div style="margin-top:10px;font-size:12px;color:#6b7280">${isQuote ? "View, save as PDF and accept online." : "View and save as PDF."}</div>
</td></tr>
</table>
<div style="margin-top:12px;font-size:11px;color:#9ca3af">${e(i.companyName)}</div>
</td></tr></table></body></html>`;

  return { html, text };
}
