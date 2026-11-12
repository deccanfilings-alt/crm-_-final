import { describe, expect, it } from "vitest";
import { describeRevert } from "./revert-stage-dialog";
import type { Invoice } from "@/types";

const inv = (o: Partial<Invoice>): Invoice => ({ id: "x", invoice_number: "N", invoice_type: "proforma", status: "unpaid", paid_amount: 0, ...o }) as Invoice;

const pi = inv({ id: "pi", invoice_number: "DF-PI-1001", quotation_id: "q1", status: "paid", paid_amount: 2360 });
const ti = inv({ id: "ti", invoice_number: "DF-TI-1001", invoice_type: "tax_invoice", quotation_id: "q1", status: "paid", source_invoice_id: "pi" });

describe("describeRevert", () => {
  it("tax invoice -> proforma", () => {
    const l = describeRevert(ti, "proforma", [pi, ti]);
    expect(l[0]).toMatch(/DF-TI-1001 will be cancelled/);
    expect(l[1]).toMatch(/DF-PI-1001 becomes unpaid again — the recorded payment of ₹2,360.00 is removed/);
  });
  it("proforma -> quotation also cancels its tax invoice", () => {
    const l = describeRevert(pi, "quotation", [pi, ti], "DF-QT-1001");
    expect(l.join(" ")).toMatch(/DF-TI-1001 will be cancelled/);
    expect(l.join(" ")).toMatch(/Proforma DF-PI-1001 will be cancelled/);
    expect(l.join(" ")).toMatch(/Quotation DF-QT-1001 is reopened/);
  });
  it("direct documents create the earlier stage", () => {
    const direct = inv({ id: "d", invoice_number: "DF-TI-1009", invoice_type: "tax_invoice", status: "paid" });
    expect(describeRevert(direct, "proforma", [direct]).join(" ")).toMatch(/new unpaid proforma/);
    expect(describeRevert(direct, "quotation", [direct]).join(" ")).toMatch(/new draft quotation/);
  });
});
