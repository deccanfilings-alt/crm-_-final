import { afterEach, describe, expect, it } from "vitest";
import { emailConfig, parseEmailList } from "./mailer";
import { buildQuotationEmail, defaultQuotationSubject } from "@/lib/billing/quotation-email";

describe("parseEmailList", () => {
  it("splits, trims, lowercases and de-dupes", () => {
    expect(parseEmailList(" A@x.com, b@y.in;a@x.com ")).toEqual(["a@x.com", "b@y.in"]);
    expect(parseEmailList("")).toEqual([]);
    expect(parseEmailList(undefined)).toEqual([]);
  });
  it("rejects anything that isn't a plain address (no header injection)", () => {
    expect(parseEmailList("not-an-email")).toBeNull();
    expect(parseEmailList("a@x.com\r\nBcc: evil@x.com")).toBeNull();
    expect(parseEmailList('"Name" <a@x.com>')).toBeNull();
    expect(parseEmailList(Array.from({ length: 6 }, (_, i) => `u${i}@x.com`), 5)).toBeNull();
  });
});

describe("emailConfig", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("needs both SMTP_USER and SMTP_PASS; strips spaces from the App Password", () => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    expect(emailConfig().configured).toBe(false);
    process.env.SMTP_USER = "deccanfilings@gmail.com";
    process.env.SMTP_PASS = "abcd efgh ijkl mnop";
    const c = emailConfig();
    expect(c).toMatchObject({ configured: true, pass: "abcdefghijklmnop", host: "smtp.gmail.com", port: 465 });
  });
});

describe("quotation email", () => {
  it("escapes the message and includes the link", () => {
    const { html, text } = buildQuotationEmail({
      quoteNumber: "DF-QT-1027",
      companyName: "Deccan Filings",
      clientName: "Ali",
      total: 3332,
      validUntil: "2026-11-27",
      link: "https://crm.deccanfilings.com/quote/abc",
      message: "Hi <b>Ali</b>\nThanks",
    });
    expect(html).toContain("Hi &lt;b&gt;Ali&lt;/b&gt;<br>Thanks");
    expect(html).toContain('href="https://crm.deccanfilings.com/quote/abc"');
    expect(html).toContain("₹3,332.00");
    expect(text).toContain("Valid until: 27/11/2026");
    expect(defaultQuotationSubject("DF-QT-1027", "Deccan Filings")).toBe("Quotation DF-QT-1027 from Deccan Filings");
  });
});
