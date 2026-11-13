import { describe, expect, it } from "vitest";
import { parseQuotationListFilters, quotationSearchExpr } from "./quotation-list";

const parse = (qs: string) => parseQuotationListFilters(new URLSearchParams(qs));

describe("parseQuotationListFilters", () => {
  it("defaults", () => {
    expect(parse("")).toEqual({ status: "all", q: null, clientId: null, groupId: null, from: null, to: null, page: 1, pageSize: 25 });
  });
  it("reads valid values and drops bad ones", () => {
    const f = parse("status=final&q=Ali&client=22222222-2222-4222-8222-222222222222&from=2026-04-01&to=bad&page=3&page_size=50");
    expect(f).toMatchObject({ status: "final", q: "Ali", clientId: "22222222-2222-4222-8222-222222222222", from: "2026-04-01", to: null, page: 3, pageSize: 50 });
    expect(parse("status=sent&page=-4&page_size=9999&client=nope")).toMatchObject({ status: "all", page: 1, pageSize: 25, clientId: null });
  });
  it("strips characters that would break the search filter", () => {
    expect(parse("q=a%2Cb(c)*%25").q).toBe("abc");
  });
});

describe("quotationSearchExpr", () => {
  it("searches number, client, company, title; phone only for 3+ digits", () => {
    expect(quotationSearchExpr("Ali")).toBe("quote_number.ilike.%Ali%,client_name.ilike.%Ali%,client_company.ilike.%Ali%,title.ilike.%Ali%");
    expect(quotationSearchExpr("96184 95888")).toContain("client_phone.ilike.%9618495888%");
  });
});
