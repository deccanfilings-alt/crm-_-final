// ============================================================
// Billing calculation engine (WebLedger rules) — quotations now,
// invoices later. Pure; used by the API (authoritative) and the form
// (live preview). All money is computed in whole paise, so totals
// never drift by floating-point error.
//
//   per line:  amount   = qty × unit price          ("Service Amount")
//              discount = INR value or % of amount
//              taxable  = amount − discount
//              tax      = taxable × GST rate
//              total    = taxable + tax
//   net total  = Σ taxable
//   tax split  = same state → CGST + SGST (half each)
//                different state → IGST
//                firm tax type NONE → no tax
//   grand      = net + taxes + Σ ledger lines − document discount + round off
//   round off  = to the nearest rupee by default (editable)
// ============================================================

import { resolveState } from "./states";

export type DiscountType = "INR" | "PERCENT";

export interface CalcItemInput {
  quantity?: number | string | null;
  unit_price?: number | string | null;
  discount_value?: number | string | null;
  discount_type?: DiscountType | null;
  gst_rate?: number | string | null;
}

export interface CalcInput {
  items: CalcItemInput[];
  /** "+ Ledger" lines; may be negative. */
  ledgers?: Array<{ amount: number | string | null | undefined }>;
  /** Document-level discount in ₹ (applied after tax). */
  docDiscount?: number | string | null;
  /** null/undefined = automatic (nearest rupee). */
  roundOff?: number | string | null;
  firmTaxType?: "GST" | "NONE";
  firmState?: string | null;
  firmGstin?: string | null;
  clientState?: string | null;
  clientGstin?: string | null;
}

export interface CalcLine {
  amount: number;
  discount: number;
  taxable: number;
  tax: number;
  lineTotal: number;
}

export interface CalcResult {
  lines: CalcLine[];
  /** Σ amount before discounts (TOTAL row of "Service Amount"). */
  serviceAmountTotal: number;
  /** Σ taxable. */
  netTotal: number;
  totalTax: number;
  cgst: number;
  sgst: number;
  igst: number;
  interState: boolean;
  placeOfSupply: string | null;
  ledgerTotal: number;
  docDiscount: number;
  beforeRound: number;
  suggestedRoundOff: number;
  roundOff: number;
  grandTotal: number;
}

const toPaise = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const fromPaise = (p: number) => p / 100;
const num = (v: number | string | null | undefined, fallback = 0) => {
  const n = typeof v === "string" ? Number(v) : Number(v ?? fallback);
  return Number.isFinite(n) ? n : fallback;
};

export function calculateBilling(input: CalcInput): CalcResult {
  const taxed = (input.firmTaxType ?? "GST") === "GST";

  const linesP = input.items.map((it) => {
    const qty = Math.max(0, num(it.quantity, 1));
    const amount = Math.max(0, Math.round(qty * toPaise(it.unit_price)));
    const dv = Math.max(0, num(it.discount_value));
    const discount =
      it.discount_type === "PERCENT"
        ? Math.round((amount * Math.min(dv, 100)) / 100)
        : Math.min(amount, toPaise(dv));
    const taxable = amount - discount;
    const rate = taxed ? Math.max(0, num(it.gst_rate)) : 0;
    const tax = Math.round((taxable * rate) / 100);
    return { amount, discount, taxable, tax, lineTotal: taxable + tax };
  });

  const serviceAmountTotal = linesP.reduce((s, l) => s + l.amount, 0);
  const netTotal = linesP.reduce((s, l) => s + l.taxable, 0);
  const totalTax = linesP.reduce((s, l) => s + l.tax, 0);

  const firmState = resolveState(input.firmState, input.firmGstin);
  const placeOfSupply = resolveState(input.clientState, input.clientGstin) ?? firmState;
  // Unknown state on either side -> treat as same state (CGST + SGST).
  const interState = !!firmState && !!placeOfSupply && firmState !== placeOfSupply;

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (interState) {
    igst = totalTax;
  } else {
    cgst = Math.round(totalTax / 2);
    sgst = totalTax - cgst;
  }

  const ledgerTotal = (input.ledgers ?? []).reduce((s, l) => s + toPaise(l.amount), 0);
  const docDiscount = Math.max(0, toPaise(input.docDiscount));
  const beforeRound = netTotal + totalTax + ledgerTotal - docDiscount;
  const suggestedRoundOff = Math.round(beforeRound / 100) * 100 - beforeRound;
  const roundOff = input.roundOff === null || input.roundOff === undefined || input.roundOff === ""
    ? suggestedRoundOff
    : toPaise(input.roundOff);
  const grandTotal = beforeRound + roundOff;

  return {
    lines: linesP.map((l) => ({
      amount: fromPaise(l.amount),
      discount: fromPaise(l.discount),
      taxable: fromPaise(l.taxable),
      tax: fromPaise(l.tax),
      lineTotal: fromPaise(l.lineTotal),
    })),
    serviceAmountTotal: fromPaise(serviceAmountTotal),
    netTotal: fromPaise(netTotal),
    totalTax: fromPaise(totalTax),
    cgst: fromPaise(cgst),
    sgst: fromPaise(sgst),
    igst: fromPaise(igst),
    interState,
    placeOfSupply,
    ledgerTotal: fromPaise(ledgerTotal),
    docDiscount: fromPaise(docDiscount),
    beforeRound: fromPaise(beforeRound),
    suggestedRoundOff: fromPaise(suggestedRoundOff),
    roundOff: fromPaise(roundOff),
    grandTotal: fromPaise(grandTotal),
  };
}

// ------------------------------------------------------------
// Amount in words, Indian numbering (lakh / crore)
// ------------------------------------------------------------
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}

/** 1234567 -> "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven". */
export function indianNumberToWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push(`${indianNumberToWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

/** 22000.5 -> "Twenty Two Thousand Rupees and Fifty Paise Only". */
export function amountInWords(amount: number): string {
  const paiseTotal = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  const minus = amount < 0 && paiseTotal > 0 ? "Minus " : "";
  const r = `${indianNumberToWords(rupees)} Rupees`;
  return `${minus}${paise ? `${r} and ${belowHundred(paise)} Paise` : r} Only`;
}
