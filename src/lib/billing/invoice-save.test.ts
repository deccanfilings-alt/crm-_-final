import { describe, expect, it } from "vitest";
import { buildInvoiceSave, validateInvoiceInput } from "./invoice-save";

const firm = { id: "f1", tax_type: "GST" as const, state: "Telangana", gstin: null };
const base = {
  invoice_type: "proforma",
  status: "final",
  issue_date: "2026-11-13",
  due_date: "2026-11-20",
  billed_from: { name: "Deccan Filings", state: "Telangana" },
  billed_to: { name: "Acme", state: "Telangana" },
  items: [{ title: "GST Registration", unit_price: 2000, gst_rate: 18 }],
};

describe("validateInvoiceInput", () => {
  it("needs an invoice type and uses due date", () => {
    expect(validateInvoiceInput({ ...base, invoice_type: "receipt" })).toEqual({ ok: false, error: "Pick Proforma or Tax Invoice" });
    const r = validateInvoiceInput(base);
    expect(r.ok && r.value).toMatchObject({ invoice_type: "proforma", due_date: "2026-11-20", payment_received: false, payment_method: null });
    expect(validateInvoiceInput({ ...base, due_date: "2026-11-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/Due date/) });
  });
  it("tax invoice: payment received by default, method validated", () => {
    const r = validateInvoiceInput({ ...base, invoice_type: "tax_invoice", payment_method: "bank_transfer", payment_reference: " UTR1 ", paid_on: "2026-11-12" });
    expect(r.ok && r.value).toMatchObject({ payment_received: true, payment_method: "bank_transfer", payment_reference: "UTR1", paid_on: "2026-11-12" });
    const bogus = validateInvoiceInput({ ...base, invoice_type: "tax_invoice", payment_method: "bitcoin" });
    expect(bogus.ok && bogus.value.payment_method).toBe("upi");
    const unpaid = validateInvoiceInput({ ...base, invoice_type: "tax_invoice", payment_received: false, payment_method: "cash" });
    expect(unpaid.ok && unpaid.value).toMatchObject({ payment_received: false, payment_method: null });
  });
  it("a proforma never arrives already paid", () => {
    const r = validateInvoiceInput({ ...base, payment_received: true });
    expect(r.ok && r.value.payment_received).toBe(false);
  });
});

describe("buildInvoiceSave", () => {
  it("totals plus invoice fields; paid only for a received tax invoice", () => {
    const v = validateInvoiceInput(base);
    if (!v.ok) throw new Error(v.error);
    const { doc } = buildInvoiceSave(v.value, firm);
    expect(doc).toMatchObject({ invoice_type: "proforma", total_amount: 2360, cgst_amount: 180, sgst_amount: 180, due_date: "2026-11-20", paid_amount: 0, draft: false });
    expect("valid_until" in doc).toBe(false);

    const t = validateInvoiceInput({ ...base, invoice_type: "tax_invoice", status: "draft", paid_on: "2026-11-12" });
    if (!t.ok) throw new Error(t.error);
    const td = buildInvoiceSave(t.value, firm).doc;
    expect(td).toMatchObject({ paid_amount: 2360, payment_method: "upi", draft: true, paid_at: "2026-11-12T06:30:00.000Z" });
  });
});
