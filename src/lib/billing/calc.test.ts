import { describe, expect, it } from "vitest";
import { amountInWords, calculateBilling, indianNumberToWords } from "./calc";
import { canonicalState, resolveState, stateFromGstin } from "./states";

const TS = { firmState: "Telangana" };

describe("line items", () => {
  it("amount, INR and % discount, GST per line", () => {
    const r = calculateBilling({
      ...TS,
      items: [
        { quantity: 1, unit_price: 1500, gst_rate: 18 },
        { quantity: 2, unit_price: 1000, discount_value: 10, discount_type: "PERCENT", gst_rate: 18 },
        { quantity: 1, unit_price: 500, discount_value: 100, discount_type: "INR", gst_rate: 0 },
      ],
    });
    expect(r.lines).toEqual([
      { amount: 1500, discount: 0, taxable: 1500, tax: 270, lineTotal: 1770 },
      { amount: 2000, discount: 200, taxable: 1800, tax: 324, lineTotal: 2124 },
      { amount: 500, discount: 100, taxable: 400, tax: 0, lineTotal: 400 },
    ]);
    expect(r.serviceAmountTotal).toBe(4000);
    expect(r.netTotal).toBe(3700);
    expect(r.totalTax).toBe(594);
  });
  it("caps discounts: INR at the amount, % at 100", () => {
    const r = calculateBilling({
      items: [
        { unit_price: 100, discount_value: 500, discount_type: "INR", gst_rate: 18 },
        { unit_price: 100, discount_value: 150, discount_type: "PERCENT", gst_rate: 18 },
      ],
    });
    expect(r.lines.map((l) => l.taxable)).toEqual([0, 0]);
  });
  it("quantity defaults to 1 and accepts strings", () => {
    const r = calculateBilling({ items: [{ unit_price: "1,250.50", gst_rate: "18" }] });
    expect(r.lines[0]).toMatchObject({ amount: 1250.5, tax: 225.09 });
  });
});

describe("CGST/SGST vs IGST", () => {
  const items = [{ unit_price: 1000, gst_rate: 18 }];
  it("same state -> CGST + SGST", () => {
    const r = calculateBilling({ ...TS, clientState: "telangana", items });
    expect(r).toMatchObject({ cgst: 90, sgst: 90, igst: 0, interState: false, placeOfSupply: "Telangana" });
  });
  it("different state -> IGST", () => {
    const r = calculateBilling({ ...TS, clientState: "Karnataka", items });
    expect(r).toMatchObject({ cgst: 0, sgst: 0, igst: 180, interState: true, placeOfSupply: "Karnataka" });
  });
  it("client state from GSTIN when no state given", () => {
    const r = calculateBilling({ ...TS, clientGstin: "29AAAAA0000A1Z5", items });
    expect(r.igst).toBe(180);
  });
  it("unknown client state -> treated as same state", () => {
    expect(calculateBilling({ ...TS, items }).cgst).toBe(90);
    expect(calculateBilling({ items }).cgst).toBe(90);
  });
  it("odd paise split: CGST rounds, SGST takes the rest", () => {
    const r = calculateBilling({ ...TS, items: [{ unit_price: 0.55, gst_rate: 18 }] }); // tax 0.10 -> 0.05 + 0.05
    expect(r.cgst + r.sgst).toBeCloseTo(r.totalTax, 10);
    const r2 = calculateBilling({ ...TS, items: [{ unit_price: 0.5, gst_rate: 18 }] }); // tax 0.09
    expect(r2.cgst).toBe(0.05);
    expect(r2.sgst).toBe(0.04);
  });
  it("firm without GST -> no tax at all", () => {
    const r = calculateBilling({ firmTaxType: "NONE", items });
    expect(r).toMatchObject({ totalTax: 0, cgst: 0, sgst: 0, igst: 0, grandTotal: 1000 });
  });
});

describe("totals", () => {
  it("ledgers (+/-), document discount, auto round off", () => {
    const r = calculateBilling({
      ...TS,
      items: [{ unit_price: 1234.56, gst_rate: 18 }], // tax 222.22 -> 1456.78
      ledgers: [{ amount: 500 }, { amount: -425 }],
      docDiscount: 100,
    });
    expect(r.ledgerTotal).toBe(75);
    expect(r.beforeRound).toBe(1431.78);
    expect(r.suggestedRoundOff).toBe(0.22);
    expect(r.roundOff).toBe(0.22);
    expect(r.grandTotal).toBe(1432);
  });
  it("manual round off overrides, including 0", () => {
    const base = { ...TS, items: [{ unit_price: 100.4, gst_rate: 0 }] };
    expect(calculateBilling({ ...base, roundOff: 0 }).grandTotal).toBe(100.4);
    expect(calculateBilling({ ...base, roundOff: -0.4 }).grandTotal).toBe(100);
    expect(calculateBilling({ ...base, roundOff: null }).grandTotal).toBe(100);
  });
  it("no floating point drift", () => {
    const r = calculateBilling({ items: Array.from({ length: 10 }, () => ({ unit_price: 0.1, gst_rate: 0 })), roundOff: 0 });
    expect(r.grandTotal).toBe(1);
  });
});

describe("amount in words (Indian)", () => {
  it("lakh / crore", () => {
    expect(indianNumberToWords(22000)).toBe("Twenty Two Thousand");
    expect(indianNumberToWords(1234567)).toBe("Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven");
    expect(indianNumberToWords(105000000)).toBe("Ten Crore Fifty Lakh");
    expect(indianNumberToWords(0)).toBe("Zero");
  });
  it("rupees and paise", () => {
    expect(amountInWords(22000)).toBe("Twenty Two Thousand Rupees Only");
    expect(amountInWords(2950.5)).toBe("Two Thousand Nine Hundred Fifty Rupees and Fifty Paise Only");
    expect(amountInWords(101)).toBe("One Hundred One Rupees Only");
  });
});

describe("states", () => {
  it("names, aliases, GSTIN codes", () => {
    expect(canonicalState("  telangana ")).toBe("Telangana");
    expect(canonicalState("New Delhi")).toBe("Delhi");
    expect(canonicalState("Orissa")).toBe("Odisha");
    expect(canonicalState("Atlantis")).toBeNull();
    expect(stateFromGstin("36ABCDE1234F1Z5")).toBe("Telangana");
    expect(stateFromGstin("bad")).toBeNull();
    expect(resolveState(null, "27ABCDE1234F1Z5")).toBe("Maharashtra");
    expect(resolveState("Karnataka", "27ABCDE1234F1Z5")).toBe("Karnataka");
  });
});
