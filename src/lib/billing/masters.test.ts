import { describe, expect, it } from "vitest";
import {
  financialYear,
  formatSeriesNumber,
  validateLedger,
  validateParticular,
  validateSeriesPeriods,
  validateTaxRates,
} from "./masters";

describe("particulars", () => {
  it("validates and cleans", () => {
    const r = validateParticular({ name: "  Trade License ", gst_rate: "18", default_amount: "1,500", sac_code: "998231", description: "x".repeat(300) });
    expect(r.ok && r.value).toMatchObject({ name: "Trade License", gst_rate: 18, default_amount: 1500, sac_code: "998231" });
    expect(r.ok && r.value.description?.length).toBe(250);
  });
  it("rejects bad input", () => {
    expect(validateParticular({}).ok).toBe(false);
    expect(validateParticular({ name: "A", gst_rate: 120 }).ok).toBe(false);
    expect(validateParticular({ name: "A", default_amount: -5 }).ok).toBe(false);
    expect(validateParticular({ name: "A", sac_code: "12ab" }).ok).toBe(false);
  });
});

describe("ledgers", () => {
  it("needs a name and a known group", () => {
    expect(validateLedger({ name: "Bad Debts", ledger_group: "Indirect Expenses" }).ok).toBe(true);
    expect(validateLedger({ name: "Bad Debts", ledger_group: "Whatever" }).ok).toBe(false);
    expect(validateLedger({ ledger_group: "Indirect Expenses" }).ok).toBe(false);
  });
});

describe("tax rates", () => {
  it("dedupes and sorts", () => {
    const r = validateTaxRates({ gst: [18, "5", 0, 18, 28, 12], vat: [5, 0] });
    expect(r.ok && r.value).toEqual({ GST: [0, 5, 12, 18, 28], VAT: [0, 5] });
  });
  it("rejects bad rates and empty GST", () => {
    expect(validateTaxRates({ gst: [18, 101], vat: [] }).ok).toBe(false);
    expect(validateTaxRates({ gst: [], vat: [5] }).ok).toBe(false);
  });
});

describe("series periods", () => {
  it("accepts a fallback + FY rows", () => {
    const r = validateSeriesPeriods([
      { prefix: "DF-QT-", starting_no: 1001, next_no: 1027 },
      { prefix: "DF/", suffix: "/26-27", applicable_from: "2026-04-01", applicable_to: "2027-03-31", starting_no: 1 },
    ]);
    expect(r.ok && r.value[1]).toMatchObject({ prefix: "DF/", suffix: "/26-27", next_no: 1 });
  });
  it("next number can't be below the starting number", () => {
    const r = validateSeriesPeriods([{ prefix: "Q", starting_no: 100, next_no: 5 }]);
    expect(r.ok && r.value[0].next_no).toBe(100);
  });
  it("rejects overlaps, two fallbacks, bad dates, empty rows", () => {
    expect(validateSeriesPeriods([]).ok).toBe(false);
    expect(validateSeriesPeriods([{ prefix: "A" }, { prefix: "B" }]).ok).toBe(false);
    expect(validateSeriesPeriods([{ prefix: "A", applicable_from: "2026-04-01", applicable_to: "2026-01-01" }]).ok).toBe(false);
    expect(validateSeriesPeriods([{ prefix: "A", applicable_to: "2026-01-01" }]).ok).toBe(false);
    expect(
      validateSeriesPeriods([
        { prefix: "A", applicable_from: "2026-04-01", applicable_to: "2027-03-31" },
        { prefix: "B", applicable_from: "2027-01-01", applicable_to: "2027-12-31" },
      ]).ok,
    ).toBe(false);
    expect(validateSeriesPeriods([{ prefix: "", suffix: "" }]).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("financial year and number format", () => {
    expect(financialYear(new Date(2026, 10, 13))).toEqual({ from: "2026-04-01", to: "2027-03-31", label: "26-27" });
    expect(financialYear(new Date(2027, 1, 1)).label).toBe("26-27");
    expect(financialYear(new Date(2027, 3, 1)).label).toBe("27-28");
    expect(formatSeriesNumber("TOR/26-27/QU", 103, "")).toBe("TOR/26-27/QU103");
  });
});
