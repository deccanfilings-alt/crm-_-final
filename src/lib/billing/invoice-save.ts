// ============================================================
// New invoice form (proforma / tax invoice) -> billing_save_invoice().
// Same validation and totals as quotations (quotation-save.ts) plus:
// invoice type, due date, and — for a new tax invoice — whether the
// payment was already received. Payment amounts on an existing invoice
// always come from the database (record payment), never from the form.
// ============================================================

import { buildQuotationSave, validateQuotationInput, type FirmForCalc, type QuotationFormInput } from "./quotation-save";

export type InvoiceType = "proforma" | "tax_invoice";

export interface InvoiceFormInput extends QuotationFormInput {
  invoice_type: InvoiceType;
  due_date: string | null;
  quotation_id: string | null;
  payment_received: boolean;
  payment_method: string | null;
  payment_reference: string | null;
  paid_on: string | null;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const METHODS = ["upi", "bank_transfer", "card", "cheque", "cash", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateInvoiceInput(body: Record<string, unknown>): Result<InvoiceFormInput> {
  // Reuse the quotation rules; "due date" plays the part of "valid until".
  const base = validateQuotationInput({ ...body, valid_until: body.due_date ?? null });
  if (!base.ok) {
    return { ok: false, error: base.error.replace("Valid-until", "Due date").replace("quotation date", "invoice date") };
  }
  const type = body.invoice_type === "tax_invoice" ? "tax_invoice" : body.invoice_type === "proforma" ? "proforma" : null;
  if (!type) return { ok: false, error: "Pick Proforma or Tax Invoice" };

  const received = type === "tax_invoice" && body.payment_received !== false;
  const method = typeof body.payment_method === "string" && METHODS.includes(body.payment_method) ? body.payment_method : received ? "upi" : null;
  const paidOn = typeof body.paid_on === "string" && DATE.test(body.paid_on) ? body.paid_on : null;
  const ref = typeof body.payment_reference === "string" ? body.payment_reference.trim().slice(0, 100) || null : null;

  return {
    ok: true,
    value: {
      ...base.value,
      invoice_type: type,
      due_date: base.value.valid_until,
      quotation_id: typeof body.quotation_id === "string" && UUID.test(body.quotation_id) ? body.quotation_id : null,
      payment_received: received,
      payment_method: received ? method : null,
      payment_reference: received ? ref : null,
      paid_on: received ? paidOn : null,
    },
  };
}

/** Totals via the shared engine + the invoice-only fields. */
export function buildInvoiceSave(input: InvoiceFormInput, firm: FirmForCalc) {
  const q = buildQuotationSave(input, firm);
  const { valid_until: _validUntil, status: _status, ...rest } = q.doc;
  const total = q.doc.total_amount;
  const doc = {
    ...rest,
    invoice_type: input.invoice_type,
    draft: input.status === "draft",
    due_date: input.due_date,
    quotation_id: input.quotation_id,
    // Used only when creating: a tax invoice for money already received.
    paid_amount: input.payment_received ? total : 0,
    payment_method: input.payment_method,
    payment_reference: input.payment_reference,
    paid_at: input.paid_on ? new Date(`${input.paid_on}T12:00:00+05:30`).toISOString() : null,
  };
  return { doc, items: q.items, ledgers: q.ledgers, totals: q.totals };
}
