import { describe, expect, it } from "vitest";
import { buildQuotationSave, validateQuotationInput } from "./quotation-save";

const firm = { id: "f1", tax_type: "GST" as const, state: "Telangana", gstin: "36ABCDE1234F1Z5" };
const base = {
  status: "final",
  series_id: "11111111-1111-4111-8111-111111111111",
  issue_date: "2026-11-13",
  valid_until: "2026-11-27",
  contact_id: "22222222-2222-4222-8222-222222222222",
  billed_from: { name: "Deccan Filings", state: "Telangana" },
  billed_to: { name: "Srikanth Ventures LLP", contact_name: "Ali", phone: "919618495888", state: "telangana", gstin: "36aaaaa0000a1z5" },
  items: [
    { title: "TRADE LICENSE", description: "Based on SFT", unit_price: 1500, gst_rate: 18 },
    { title: "LABOUR LICENSE", unit_price: 1000, discount_value: 10, discount_type: "PERCENT", gst_rate: 18 },
  ],
  ledgers: [{ ledger_name: "Government Fees", amount: 500 }],
};

describe("validateQuotationInput", () => {
  it("accepts a full form and cleans it", () => {
    const r = validateQuotationInput(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.billed_to.state).toBe("Telangana");
    expect(r.value.billed_to.gstin).toBe("36AAAAA0000A1Z5");
    expect(r.value.title).toBe("TRADE LICENSE"); // defaults to the first item
    expect(r.value.items[0]).toMatchObject({ quantity: 1, discount_type: "INR", linked_task_ids: [] });
    expect(r.value.save_client_details).toBe(true);
  });
  it("rejects bad input with a clear message", () => {
    const bad = (patch: Record<string, unknown>) => validateQuotationInput({ ...base, ...patch });
    expect(bad({ items: [] })).toEqual({ ok: false, error: "Add at least one line item" });
    expect(bad({ billed_to: { name: "" } })).toMatchObject({ ok: false });
    expect(bad({ valid_until: "2026-11-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/before/) });
    expect(bad({ running_no: "1.5" })).toMatchObject({ ok: false });
    expect(bad({ items: [{ title: "A", unit_price: 10, discount_value: 150, discount_type: "PERCENT" }] })).toMatchObject({ ok: false });
    expect(bad({ items: [{ title: "A", unit_price: 10, sac_code: "12a" }] })).toMatchObject({ ok: false });
    expect(bad({ billed_to: { name: "X", gstin: "SHORT" } })).toMatchObject({ ok: false });
    expect(bad({ billed_to: { name: "X", pan: "123" } })).toMatchObject({ ok: false });
  });
});

describe("buildQuotationSave", () => {
  it("computes totals, CGST/SGST and legacy fields", () => {
    const v = validateQuotationInput(base);
    if (!v.ok) throw new Error(v.error);
    const { doc, items } = buildQuotationSave(v.value, firm);
    // 1500 + 900 = 2400 net; tax 270 + 162 = 432; + 500 ledger = 3332
    expect(doc).toMatchObject({
      subtotal: 2400,
      tax_amount: 432,
      cgst_amount: 216,
      sgst_amount: 216,
      igst_amount: 0,
      ledger_adjustments_total: 500,
      round_off: 0,
      total_amount: 3332,
      place_of_supply: "Telangana",
      client_name: "Ali",
      client_company: "Srikanth Ventures LLP",
      tax_rate: 18,
      status: "final",
    });
    expect(items[1]).toMatchObject({ taxable_amount: 900, tax_amount: 162, line_total: 1062 });
  });
  it("IGST for an out-of-state client (from GSTIN)", () => {
    const v = validateQuotationInput({ ...base, billed_to: { name: "Bengaluru Co", gstin: "29AAAAA0000A1Z5" } });
    if (!v.ok) throw new Error(v.error);
    const { doc } = buildQuotationSave(v.value, firm);
    expect(doc).toMatchObject({ igst_amount: 432, cgst_amount: 0, place_of_supply: "Karnataka", client_name: "Bengaluru Co", client_company: null });
  });
  it("no tax for a firm without GST", () => {
    const v = validateQuotationInput(base);
    if (!v.ok) throw new Error(v.error);
    const { doc, items } = buildQuotationSave(v.value, { ...firm, tax_type: "NONE" });
    expect(doc.tax_amount).toBe(0);
    expect(doc.tax_type).toBe("none");
    expect(items.every((i) => i.gst_rate === 0)).toBe(true);
  });
});
