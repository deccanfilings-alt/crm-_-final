import { describe, expect, it } from "vitest";
import { buildQuotationDocument, renderQuotationDocumentHtml } from "./quotation-document";

const settings = {
  company_name: "Deccan Filings",
  bank_name: "HDFC Bank",
  bank_account_no: "50200012345678",
  bank_ifsc: "HDFC0001234",
  upi_id: "deccan@hdfcbank",
  default_terms: "Pay within 7 days",
};

const quote = {
  quote_number: "DF-QT-1027",
  revision: 1,
  status: "final",
  issue_date: "2026-11-13",
  valid_until: "2026-11-27",
  title: "Licences",
  tax_type: "gst",
  billed_from: { name: "Deccan Filings", address: "Banjara Hills", state: "Telangana", gstin: "36ABCDE1234F1Z5" },
  billed_to: { name: "Srikanth Ventures LLP", contact_name: "Ali", state: "Telangana", phone: "919618495888" },
  place_of_supply: "Telangana",
  subtotal: 2400,
  cgst_amount: 216,
  sgst_amount: 216,
  igst_amount: 0,
  tax_amount: 432,
  discount_amount: 0,
  round_off: 0,
  total_amount: 3332,
  items: [
    { position: 1, title: "LABOUR LICENSE", quantity: 1, unit_price: 1000, discount_type: "PERCENT", discount_value: 10, gst_rate: 18, taxable_amount: 900, tax_amount: 162, line_total: 1062 },
    { position: 0, title: "TRADE LICENSE", description: "Based on SFT", quantity: 1, unit_price: 1500, gst_rate: 18, sac_code: "998231", taxable_amount: 1500, tax_amount: 270, line_total: 1770 },
  ],
  ledger_lines: [{ ledger_name: "Government Fees", amount: 500, position: 0 }],
};

describe("buildQuotationDocument", () => {
  it("orders items, works out discounts and shows only used columns", () => {
    const d = buildQuotationDocument(quote, settings);
    expect(d.items.map((i) => i.title)).toEqual(["TRADE LICENSE", "LABOUR LICENSE"]);
    expect(d.items[1]).toMatchObject({ amount: 1000, discount: 100, discountLabel: "10%", taxable: 900 });
    expect(d.show).toEqual({ sac: true, qty: false, discount: true, service: false });
    expect(d.totals).toMatchObject({ net: 2400, cgst: 216, sgst: 216, igst: 0, grand: 3332 });
    expect(d.totals.ledgers).toEqual([{ name: "Government Fees", amount: 500 }]);
    expect(d.totals.words).toBe("Three Thousand Three Hundred Thirty Two Rupees Only");
    expect(d.upiQrUrl).toContain(encodeURIComponent("am=3332.00"));
    expect(d.terms).toBe("Pay within 7 days");
  });
  it("old quotations: single tax line split CGST + SGST, client from legacy columns", () => {
    const d = buildQuotationDocument(
      { quote_number: "DF-QT-1001", status: "final", tax_type: "gst", tax_amount: 450, total_amount: 2950, client_name: "Ali", client_company: "Acme", items: [{ title: "X", quantity: 1, unit_price: 2500, total: 2500, tax_rate: 18 }] },
      settings,
    );
    expect(d.totals).toMatchObject({ cgst: 225, sgst: 225 });
    expect(d.to).toMatchObject({ name: "Acme", contact_name: "Ali" });
    expect(d.items[0]).toMatchObject({ taxable: 2500, gstRate: 18, tax: 450 });
  });
});

describe("renderQuotationDocumentHtml", () => {
  it("renders the key parts and IGST when inter-state", () => {
    const html = renderQuotationDocumentHtml(buildQuotationDocument(quote, settings), { printBar: true });
    expect(html).toContain("DF-QT-1027");
    expect(html).toContain("(Rev 1)");
    expect(html).toContain("ISSUED BY");
    expect(html).toContain("BILLED TO");
    expect(html).toContain("CGST");
    expect(html).toContain("Government Fees");
    expect(html).toContain("Print / Save PDF");
    expect(html).not.toContain("WebLedger");
    const igst = renderQuotationDocumentHtml(buildQuotationDocument({ ...quote, cgst_amount: 0, sgst_amount: 0, igst_amount: 432 }, settings));
    expect(igst).toContain("IGST");
    expect(igst).not.toContain(">CGST<");
    expect(igst).not.toContain("Print / Save PDF");
  });
  it("escapes client-provided text and refuses non-http image URLs", () => {
    const html = renderQuotationDocumentHtml(
      buildQuotationDocument({ ...quote, billed_to: { name: '<script>alert(1)</script>' }, billed_from: { name: "DF", logo_url: "javascript:alert(1)" } }, settings),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:alert");
  });
  it("watermarks drafts and cancelled quotations", () => {
    expect(renderQuotationDocumentHtml(buildQuotationDocument({ ...quote, status: "draft" }, settings))).toContain(">DRAFT<");
    expect(renderQuotationDocumentHtml(buildQuotationDocument({ ...quote, status: "cancelled" }, settings))).toContain(">CANCELLED<");
  });
});
