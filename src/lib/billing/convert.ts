// ============================================================
// Convert a quotation into a proforma or tax invoice (single or bulk).
// Copies client, company, items and totals; the quotation becomes
// "Invoiced" and remembers its invoice.
// ============================================================

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getQuotationSettings } from "@/lib/quotations/settings";
import { allocateDocumentNumber, isDuplicateNumber } from "@/lib/quotations/next-number";

export interface ConvertOptions {
  invoiceType: "proforma" | "tax_invoice";
  /** YYYY-MM-DD; default today (India). */
  invoiceDate?: string | null;
  /** Due date = invoice date + N days (proforma / unpaid). */
  dueDays?: number | null;
  /** Tax invoice only: payment already received (default true). */
  paymentReceived?: boolean;
  paymentMethod?: string | null;
  paymentReference?: string | null;
}

export type ConvertResult =
  | { ok: true; invoice: Record<string, unknown> & { id: string; invoice_number: string } }
  | { ok: false; status: number; error: string };

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function convertQuotationToInvoice(
  supabase: SupabaseClient,
  userId: string,
  quoteId: string,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const { data: quote, error: quoteErr } = await supabase
    .from("quotations")
    .select("*, items:quotation_items(*)")
    .eq("id", quoteId)
    .maybeSingle();
  if (quoteErr || !quote || quote.deleted_at) return { ok: false, status: 404, error: "Quotation not found" };
  if (quote.status === "invoiced") {
    return { ok: false, status: 409, error: `${quote.quote_number} is already invoiced` };
  }
  if (quote.status === "cancelled") {
    return { ok: false, status: 409, error: `${quote.quote_number} is cancelled` };
  }

  const settings = await getQuotationSettings(supabase, quote.account_id);
  const issueDate = opts.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.invoiceDate) ? opts.invoiceDate : todayIST();
  const total = Number(quote.total_amount) || 0;
  const isPaid = opts.invoiceType === "tax_invoice" && opts.paymentReceived !== false;
  const paidAmount = isPaid ? total : 0;
  const dueDays = opts.dueDays != null && Number.isFinite(opts.dueDays) ? Math.max(0, Math.round(opts.dueDays)) : null;

  const payload: Record<string, unknown> = {
    account_id: quote.account_id,
    quotation_id: quote.id,
    invoice_type: opts.invoiceType,
    invoice_number: await allocateDocumentNumber(supabase, quote.account_id, opts.invoiceType, settings),
    title: `${opts.invoiceType === "proforma" ? "Proforma Invoice" : "Tax Invoice"} - ${quote.title}`,
    contact_id: quote.contact_id,
    deal_id: quote.deal_id,
    conversation_id: quote.conversation_id,
    created_by_user_id: userId,
    status: isPaid ? "paid" : "unpaid",
    issue_date: issueDate,
    due_date: isPaid ? null : dueDays != null ? addDays(issueDate, dueDays) : null,
    currency: quote.currency || "INR",

    subtotal: quote.subtotal,
    discount_type: quote.discount_type,
    discount_value: quote.discount_value,
    discount_amount: quote.discount_amount,
    tax_type: quote.tax_type,
    tax_rate: quote.tax_rate,
    tax_amount: quote.tax_amount,
    total_amount: total,

    paid_amount: paidAmount,
    balance_amount: Math.max(0, Math.round((total - paidAmount) * 100) / 100),
    payment_method: isPaid ? opts.paymentMethod || "upi" : null,
    payment_reference: isPaid ? opts.paymentReference || null : null,
    paid_at: isPaid ? new Date().toISOString() : null,

    client_name: quote.client_name,
    client_phone: quote.client_phone,
    client_email: quote.client_email,
    client_company: quote.client_company,
    client_address: quote.client_address,
    client_gstin: quote.client_gstin,

    company_name: quote.company_name || settings.company_name,
    company_logo_url: quote.company_logo_url || settings.company_logo_url,
    company_address: quote.company_address || settings.company_address,
    company_phone: quote.company_phone || settings.company_phone,
    company_email: quote.company_email || settings.company_email,
    company_website: quote.company_website || settings.company_website,
    gstin: quote.gstin || settings.gstin,
    pan: quote.pan || settings.pan,
    signature_url: quote.signature_url || settings.signature_url,
    stamp_url: quote.stamp_url || settings.stamp_url,

    bank_name: settings.bank_name,
    bank_account_no: settings.bank_account_no,
    bank_ifsc: settings.bank_ifsc,
    bank_beneficiary_name: settings.bank_beneficiary_name,
    upi_id: settings.upi_id,
    upi_qr_url: settings.upi_qr_url,

    notes: quote.notes,
    terms: quote.terms || settings.default_terms,
    custom_message: quote.custom_message,
    public_token: randomBytes(16).toString("hex"),
  };

  let { data: invoice, error: invErr } = await supabase.from("invoices").insert(payload).select().single();
  for (let attempt = 0; attempt < 3 && isDuplicateNumber(invErr); attempt++) {
    payload.invoice_number = await allocateDocumentNumber(supabase, quote.account_id, opts.invoiceType, settings);
    ({ data: invoice, error: invErr } = await supabase.from("invoices").insert(payload).select().single());
  }
  if (invErr || !invoice) {
    console.error("[billing/convert] insert error:", invErr);
    return { ok: false, status: 500, error: invErr?.message || "Could not create the invoice" };
  }

  const items = [...(quote.items ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (items.length) {
    const { error: itemsErr } = await supabase.from("invoice_items").insert(
      items.map((it: Record<string, unknown>, idx: number) => ({
        invoice_id: invoice.id,
        position: idx,
        title: it.title,
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        tax_rate: it.gst_rate ?? it.tax_rate,
        // After any line discount, so the lines add up to the subtotal.
        total: it.taxable_amount ?? it.total,
      })),
    );
    if (itemsErr) {
      console.error("[billing/convert] items error:", itemsErr);
      // RLS only allows deleting drafts: flip to draft first.
      await supabase.from("invoices").update({ status: "draft" }).eq("id", invoice.id);
      await supabase.from("invoices").delete().eq("id", invoice.id);
      return { ok: false, status: 500, error: "Could not copy the line items — nothing was converted" };
    }
  }

  const { error: qErr } = await supabase
    .from("quotations")
    .update({ status: "invoiced", converted_invoice_id: invoice.id, updated_at: new Date().toISOString() })
    .eq("id", quote.id);
  if (qErr) console.warn("[billing/convert] quotation status not updated:", qErr.message);

  const { data: complete } = await supabase.from("invoices").select("*, items:invoice_items(*)").eq("id", invoice.id).single();
  return { ok: true, invoice: (complete ?? invoice) as Record<string, unknown> & { id: string; invoice_number: string } };
}
