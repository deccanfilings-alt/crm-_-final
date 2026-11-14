// ============================================================
// Quotation document (print / PDF and the client's public link).
// One renderer so the PDF and the public page always match.
//
//   QUOTATION · Quotation No / Date / Valid Until · logo
//   ISSUED BY | BILLED TO
//   # · Particulars · Description · SAC · Qty · Rate · Discount · GST · Amount
//   UPI QR + bank details | Net Total, CGST/SGST or IGST, ledger lines,
//                           Discount, Round Off, Grand Total
//   Amount in words · Notes · Terms · stamp + Authorized Signature
// ============================================================

import { amountInWords } from "./calc";

type Num = number | string | null | undefined;
const n = (v: Num) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export interface DocParty {
  name: string;
  contact_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  gstin?: string | null;
  pan?: string | null;
  cin?: string | null;
  logo_url?: string | null;
}

export type DocumentKind = "quotation" | "proforma" | "tax_invoice";

export interface QuotationDocument {
  kind: DocumentKind;
  number: string;
  revision: number;
  status: string;
  date: string | null;
  validUntil: string | null;
  /** Invoices: due date, payment so far and what is left. */
  dueDate: string | null;
  paid: number;
  balance: number;
  payment: { method: string | null; reference: string | null; paidAt: string | null } | null;
  subject: string | null;
  from: DocParty;
  to: DocParty;
  placeOfSupply: string | null;
  items: Array<{
    title: string;
    description: string | null;
    service: string | null;
    sac: string | null;
    qty: number;
    rate: number;
    amount: number;
    discount: number;
    discountLabel: string | null;
    gstRate: number;
    taxable: number;
    tax: number;
    lineTotal: number;
  }>;
  show: { sac: boolean; qty: boolean; discount: boolean; service: boolean };
  totals: {
    net: number;
    cgst: number;
    sgst: number;
    igst: number;
    ledgers: Array<{ name: string; amount: number }>;
    docDiscount: number;
    roundOff: number;
    grand: number;
    words: string;
  };
  taxed: boolean;
  bank: { name: string | null; accountNo: string | null; ifsc: string | null; holder: string | null; upiId: string | null };
  upiQrUrl: string | null;
  notes: string | null;
  terms: string | null;
  stampUrl: string | null;
  signatureUrl: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Works for a quotation row or an invoice row (proforma / tax invoice). */
export function buildQuotationDocument(quote: any, settings: any): QuotationDocument {
  const kind: DocumentKind = quote.invoice_type === "tax_invoice" ? "tax_invoice" : quote.invoice_type === "proforma" ? "proforma" : "quotation";
  const isInvoice = kind !== "quotation";
  // Invoices carry their own bank snapshot; quotations use current settings.
  const bankSrc = isInvoice && (quote.bank_account_no || quote.upi_id) ? quote : settings;
  const bf = (quote.billed_from ?? {}) as DocParty;
  const bt = (quote.billed_to ?? {}) as DocParty;
  const from: DocParty = {
    name: bf.name || quote.company_name || settings?.company_name || "Company",
    address: bf.address ?? quote.company_address ?? settings?.company_address ?? null,
    state: bf.state ?? settings?.company_state ?? null,
    phone: bf.phone ?? quote.company_phone ?? settings?.company_phone ?? null,
    email: bf.email ?? quote.company_email ?? settings?.company_email ?? null,
    website: bf.website ?? quote.company_website ?? settings?.company_website ?? null,
    gstin: bf.gstin ?? quote.gstin ?? settings?.gstin ?? null,
    pan: bf.pan ?? quote.pan ?? settings?.pan ?? null,
    cin: bf.cin ?? null,
    logo_url: bf.logo_url ?? quote.company_logo_url ?? settings?.company_logo_url ?? null,
  };
  const to: DocParty = {
    name: bt.name || quote.client_company || quote.client_name || "Client",
    contact_name: bt.contact_name ?? (quote.client_company && quote.client_name !== quote.client_company ? quote.client_name : null),
    address: bt.address ?? (bt.name ? null : quote.client_address) ?? null,
    city: bt.city ?? null,
    state: bt.state ?? null,
    pincode: bt.pincode ?? null,
    phone: bt.phone ?? quote.client_phone ?? null,
    email: bt.email ?? quote.client_email ?? null,
    gstin: bt.gstin ?? quote.client_gstin ?? null,
    pan: bt.pan ?? null,
    cin: bt.cin ?? null,
  };

  const taxed = quote.tax_type !== "none";
  const items = [...(quote.items ?? [])]
    .sort((a: any, b: any) => n(a.position) - n(b.position))
    .map((it: any) => {
      const qty = n(it.quantity) || 1;
      const rate = n(it.unit_price);
      const amount = Math.round(qty * rate * 100) / 100;
      const taxable = it.taxable_amount != null ? n(it.taxable_amount) : n(it.total) || amount;
      const discount = Math.max(0, Math.round((amount - taxable) * 100) / 100);
      const gstRate = taxed ? n(it.gst_rate ?? it.tax_rate) : 0;
      const tax = it.tax_amount != null ? n(it.tax_amount) : Math.round(taxable * gstRate) / 100;
      return {
        title: String(it.title ?? ""),
        description: it.description || null,
        service: it.service_name || null,
        sac: it.sac_code || null,
        qty,
        rate,
        amount,
        discount,
        discountLabel: discount > 0 ? (it.discount_type === "PERCENT" ? `${n(it.discount_value)}%` : null) : null,
        gstRate,
        taxable,
        tax,
        lineTotal: it.line_total != null ? n(it.line_total) : taxable + tax,
      };
    });

  // Old quotations stored a single tax line: split it CGST + SGST.
  let cgst = n(quote.cgst_amount);
  let sgst = n(quote.sgst_amount);
  const igst = n(quote.igst_amount);
  if (taxed && !cgst && !sgst && !igst && n(quote.tax_amount)) {
    cgst = Math.round((n(quote.tax_amount) / 2) * 100) / 100;
    sgst = Math.round((n(quote.tax_amount) - cgst) * 100) / 100;
  }
  const grand = n(quote.total_amount);
  const paid = isInvoice ? n(quote.paid_amount) : 0;
  const balance = isInvoice ? Math.max(0, Math.round((grand - paid) * 100) / 100) : grand;
  const upiId = bankSrc?.upi_id || null;
  // QR asks for what is still payable.
  const qrAmount = isInvoice ? balance : grand;

  return {
    kind,
    number: isInvoice ? quote.invoice_number : quote.quote_number,
    revision: n(quote.revision),
    status: quote.status,
    date: quote.issue_date ?? null,
    validUntil: isInvoice ? null : quote.valid_until ?? null,
    dueDate: isInvoice ? quote.due_date ?? null : null,
    paid,
    balance,
    payment:
      isInvoice && paid > 0
        ? { method: quote.payment_method ?? null, reference: quote.payment_reference ?? null, paidAt: quote.paid_at ?? null }
        : null,
    subject: quote.title || null,
    from,
    to,
    placeOfSupply: quote.place_of_supply ?? to.state ?? null,
    items,
    show: {
      sac: items.some((i) => i.sac),
      qty: items.some((i) => i.qty !== 1),
      discount: items.some((i) => i.discount > 0),
      service: items.some((i) => i.service),
    },
    totals: {
      net: n(quote.subtotal),
      cgst,
      sgst,
      igst,
      ledgers: [...(quote.ledger_lines ?? [])]
        .sort((a: any, b: any) => n(a.position) - n(b.position))
        .map((l: any) => ({ name: String(l.ledger_name ?? "Ledger"), amount: n(l.amount) })),
      docDiscount: n(quote.discount_amount),
      roundOff: n(quote.round_off),
      grand,
      words: amountInWords(grand),
    },
    taxed,
    bank: {
      name: bankSrc?.bank_name || null,
      accountNo: bankSrc?.bank_account_no || null,
      ifsc: bankSrc?.bank_ifsc || null,
      holder: bankSrc?.bank_beneficiary_name || null,
      upiId,
    },
    // Nothing left to pay -> no QR.
    upiQrUrl:
      qrAmount <= 0
        ? null
        : bankSrc?.upi_qr_url ||
          (upiId
            ? `https://quickchart.io/qr?size=150&text=${encodeURIComponent(
                `upi://pay?pa=${upiId}&pn=${from.name}&am=${qrAmount.toFixed(2)}&cu=INR&tn=${isInvoice ? quote.invoice_number : quote.quote_number}`,
              )}`
            : null),
    notes: quote.notes || null,
    terms: quote.terms || settings?.default_terms || null,
    stampUrl: quote.stamp_url || settings?.stamp_url || null,
    signatureUrl: quote.signature_url || settings?.signature_url || null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------
// HTML
// ------------------------------------------------------------
export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const e = escapeHtml;
const money = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");
const safeUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? e(u) : null);
const nl2br = (s: string) => e(s).replace(/\n/g, "<br>");

function partyRows(rows: Array<[string, string | null | undefined]>): string {
  return rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td class="k">${e(k)}</td><td>${e(v)}</td></tr>`)
    .join("");
}

export interface RenderOptions {
  /** Show the "Print / Save PDF" bar (stand-alone page). */
  printBar?: boolean;
}

export function renderQuotationDocumentHtml(doc: QuotationDocument, opts: RenderOptions = {}): string {
  const to = doc.to;
  const toAddress = [to.address, to.city, to.state, to.pincode].filter(Boolean).join(", ");
  const cols = doc.show;

  const head = [
    `<th class="c" style="width:28px">#</th>`,
    `<th>Particulars</th>`,
    cols.sac ? `<th style="width:70px">SAC</th>` : "",
    cols.qty ? `<th class="r" style="width:44px">Qty</th>` : "",
    `<th class="r" style="width:90px">${cols.qty ? "Rate" : "Amount"}</th>`,
    cols.discount ? `<th class="r" style="width:80px">Discount</th>` : "",
    doc.taxed ? `<th class="r" style="width:60px">GST</th>` : "",
    `<th class="r" style="width:100px">Sub Total</th>`,
  ].join("");

  const body = doc.items
    .map(
      (it, i) => `<tr>
      <td class="c muted">${i + 1}</td>
      <td><div class="strong">${e(it.title)}</div>${it.service ? `<div class="small muted">${e(it.service)}</div>` : ""}${
        it.description ? `<div class="small">${nl2br(it.description)}</div>` : ""
      }</td>
      ${cols.sac ? `<td class="mono small">${e(it.sac ?? "")}</td>` : ""}
      ${cols.qty ? `<td class="r">${it.qty}</td>` : ""}
      <td class="r">${money(it.rate)}</td>
      ${cols.discount ? `<td class="r">${it.discount ? `${money(it.discount)}${it.discountLabel ? `<div class="small muted">(${e(it.discountLabel)})</div>` : ""}` : "—"}</td>` : ""}
      ${doc.taxed ? `<td class="r">${it.gstRate}%</td>` : ""}
      <td class="r strong">${money(doc.taxed ? it.taxable : it.lineTotal)}</td>
    </tr>`,
    )
    .join("");

  const t = doc.totals;
  const totalRows = [
    `<tr><td>Net Total</td><td class="r">${money(t.net)}</td></tr>`,
    doc.taxed && t.igst ? `<tr><td>IGST</td><td class="r">${money(t.igst)}</td></tr>` : "",
    doc.taxed && !t.igst ? `<tr><td>CGST</td><td class="r">${money(t.cgst)}</td></tr><tr><td>SGST</td><td class="r">${money(t.sgst)}</td></tr>` : "",
    ...t.ledgers.map((l) => `<tr><td>${e(l.name)}</td><td class="r">${money(l.amount)}</td></tr>`),
    t.docDiscount ? `<tr><td>Discount</td><td class="r">-${money(t.docDiscount)}</td></tr>` : "",
    t.roundOff ? `<tr><td>Round Off</td><td class="r">${t.roundOff > 0 ? "+" : ""}${money(t.roundOff)}</td></tr>` : "",
    `<tr class="grand"><td>Grand Total</td><td class="r">₹ ${money(t.grand)}</td></tr>`,
    doc.kind !== "quotation" && doc.paid > 0 ? `<tr><td>Paid</td><td class="r">${money(doc.paid)}</td></tr>` : "",
    doc.kind !== "quotation" && doc.status !== "cancelled"
      ? `<tr><td class="strong">Remaining Amount</td><td class="r strong">₹ ${money(doc.balance)}</td></tr>`
      : "",
  ].join("");

  const bank = doc.bank;
  const hasBank = bank.accountNo || bank.upiId;
  const qr = safeUrl(doc.upiQrUrl);
  const logo = safeUrl(doc.from.logo_url);
  const stamp = safeUrl(doc.stampUrl);
  const signature = safeUrl(doc.signatureUrl);
  const watermark = doc.status === "cancelled" ? "CANCELLED" : doc.status === "draft" ? "DRAFT" : null;
  const title = doc.kind === "tax_invoice" ? "TAX INVOICE" : doc.kind === "proforma" ? "PROFORMA INVOICE" : "QUOTATION";
  const noun = doc.kind === "quotation" ? "Quotation" : "Invoice";
  const docName = doc.kind === "tax_invoice" ? "Tax Invoice" : doc.kind === "proforma" ? "Proforma Invoice" : "Quotation";
  const paidStamp = doc.kind !== "quotation" && doc.status === "paid";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(docName)} ${e(doc.number)} - ${e(doc.from.name)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, "Segoe UI", Roboto, sans-serif; color: #111827; background: #fff; margin: 0; padding: 24px; font-size: 12.5px; line-height: 1.45; }
  .page { max-width: 820px; margin: 0 auto; position: relative; }
  table { width: 100%; border-collapse: collapse; }
  .k { color: #6b7280; width: 92px; vertical-align: top; padding: 1px 8px 1px 0; }
  .r { text-align: right; } .c { text-align: center; } .mono { font-family: ui-monospace, Menlo, monospace; }
  .muted { color: #6b7280; } .small { font-size: 11px; } .strong { font-weight: 600; }
  .head h1 { margin: 0 0 10px; font-size: 24px; letter-spacing: .08em; }
  .meta td { padding: 1px 0; } .meta td:first-child { color: #6b7280; width: 110px; }
  .parties { margin: 16px 0; } .parties > tbody > tr > td { width: 50%; vertical-align: top; border: 1px solid #e5e7eb; padding: 10px 12px; }
  .label { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; color: #6b7280; margin-bottom: 4px; }
  .items th { background: #f3f4f6; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: #374151; text-align: left; padding: 7px 8px; border-bottom: 1px solid #d1d5db; }
  .items th.r { text-align: right; } .items th.c { text-align: center; }
  .items td { padding: 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  .bottom { margin-top: 14px; } .bottom > tbody > tr > td { vertical-align: top; }
  .totals td { padding: 3px 0; } .totals .grand td { border-top: 2px solid #111827; padding-top: 6px; font-size: 15px; font-weight: 700; }
  .words { margin-top: 10px; padding: 8px 10px; background: #f9fafb; border: 1px solid #e5e7eb; font-size: 12px; }
  .section { margin-top: 14px; } .section h3 { font-size: 11px; letter-spacing: .08em; color: #6b7280; margin: 0 0 4px; }
  .sign { margin-top: 26px; text-align: right; } .sign img { max-height: 70px; max-width: 160px; }
  .paid { position: absolute; top: 18px; right: 230px; border: 3px solid #16a34a; color: #16a34a; font-size: 26px; font-weight: 800; letter-spacing: .12em; padding: 4px 14px; border-radius: 6px; transform: rotate(-8deg); opacity: .85; }
  .watermark { position: absolute; top: 280px; left: 0; right: 0; text-align: center; font-size: 96px; font-weight: 800; color: rgba(220, 38, 38, .08); transform: rotate(-20deg); pointer-events: none; }
  .bar { max-width: 820px; margin: 0 auto 16px; display: flex; justify-content: space-between; align-items: center; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 6px; padding: 10px 14px; }
  .bar button { background: #111827; color: #fff; border: 0; border-radius: 5px; padding: 7px 16px; font-weight: 600; cursor: pointer; }
  @media print { body { padding: 0; } .bar { display: none !important; } }
  @media (max-width: 640px) { body { padding: 12px; } .parties > tbody > tr > td { display: block; width: 100%; } }
</style>
</head>
<body>
${opts.printBar ? `<div class="bar"><strong>${e(docName)} ${e(doc.number)}</strong><button onclick="window.print()">Print / Save PDF</button></div>` : ""}
<div class="page">
  ${watermark ? `<div class="watermark">${watermark}</div>` : ""}
  ${paidStamp ? `<div class="paid">PAID</div>` : ""}
  <table class="head"><tr>
    <td style="vertical-align:top">
      <h1>${title}</h1>
      <table class="meta" style="width:auto">
        <tr><td>${noun} No</td><td class="strong">${e(doc.number)}${doc.revision > 0 ? ` <span style="color:#b45309">(Rev ${doc.revision})</span>` : ""}</td></tr>
        ${doc.date ? `<tr><td>${noun} Date</td><td>${dmy(doc.date)}</td></tr>` : ""}
        ${doc.validUntil ? `<tr><td>Valid Until</td><td>${dmy(doc.validUntil)}</td></tr>` : ""}
        ${doc.dueDate ? `<tr><td>Due Date</td><td>${dmy(doc.dueDate)}</td></tr>` : ""}
        ${doc.placeOfSupply ? `<tr><td>Place of Supply</td><td>${e(doc.placeOfSupply)}</td></tr>` : ""}
      </table>
    </td>
    <td style="vertical-align:top;text-align:right">${logo ? `<img src="${logo}" alt="" style="max-height:70px;max-width:200px">` : ""}</td>
  </tr></table>

  ${doc.subject ? `<div style="margin-top:10px"><span class="muted">Subject:</span> <span class="strong">${e(doc.subject)}</span></div>` : ""}

  <table class="parties"><tr>
    <td>
      <div class="label">ISSUED BY</div>
      <div class="strong" style="font-size:13.5px">${e(doc.from.name)}</div>
      <table>${partyRows([
        ["Address", [doc.from.address, doc.from.state].filter(Boolean).join(", ")],
        ["Phone", doc.from.phone],
        ["Email", doc.from.email],
        ["GSTIN", doc.from.gstin],
        ["PAN", doc.from.pan],
        ["CIN", doc.from.cin],
      ])}</table>
    </td>
    <td>
      <div class="label">BILLED TO</div>
      <div class="strong" style="font-size:13.5px">${e(to.name)}</div>
      <table>${partyRows([
        ["Attn", to.contact_name],
        ["Address", toAddress],
        ["Phone", to.phone],
        ["Email", to.email],
        ["GSTIN", to.gstin],
        ["PAN", to.pan],
        ["CIN", to.cin],
      ])}</table>
    </td>
  </tr></table>

  <table class="items"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>

  <table class="bottom"><tr>
    <td style="width:55%;padding-right:18px">
      ${
        hasBank
          ? `<table><tr>
        ${qr ? `<td style="width:150px;vertical-align:top"><img src="${qr}" alt="UPI QR" style="width:130px;height:130px;border:1px solid #e5e7eb;padding:4px"><div class="small muted c">UPI scan to pay</div></td>` : ""}
        <td style="vertical-align:top">
          <div class="label">BANK DETAILS</div>
          <table>${[
            ["Bank Name", bank.name],
            ["A/c No", bank.accountNo],
            ["IFSC", bank.ifsc],
            ["UPI Id", bank.upiId],
            ["Name", bank.holder],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => `<tr><td class="k">${e(k)}</td><td>${e(v)}</td></tr>`)
            .join("")}</table>
        </td></tr></table>`
          : ""
      }
    </td>
    <td style="width:45%"><table class="totals">${totalRows}</table></td>
  </tr></table>

  <div class="words"><span class="muted">Amount in words:</span> <span class="strong">${e(t.words)}</span></div>
  ${
    doc.payment
      ? `<div class="small" style="margin-top:6px"><span class="muted">Payment received:</span> ₹ ${money(doc.paid)}${
          doc.payment.method ? ` via ${e(doc.payment.method.replace("_", " ").toUpperCase())}` : ""
        }${doc.payment.reference ? ` · Ref ${e(doc.payment.reference)}` : ""}${doc.payment.paidAt ? ` · ${dmy(doc.payment.paidAt)}` : ""}</div>`
      : ""
  }

  ${doc.notes ? `<div class="section"><h3>NOTES</h3><div>${nl2br(doc.notes)}</div></div>` : ""}
  ${doc.terms ? `<div class="section"><h3>TERMS &amp; CONDITIONS</h3><div class="small">${nl2br(doc.terms)}</div></div>` : ""}
  ${
    doc.kind === "tax_invoice"
      ? `<div class="section small"><span class="strong">Declaration:</span> Certified that the particulars given above are true and correct and the amount indicated represents the price actually charged.</div>`
      : doc.kind === "proforma"
        ? `<div class="section small muted">This is a proforma invoice for advance payment. The tax invoice is issued once payment is received.</div>`
        : ""
  }

  <div class="sign">
    <div class="strong">For ${e(doc.from.name)}</div>
    <div style="min-height:72px;margin:6px 0">${stamp ? `<img src="${stamp}" alt="Stamp">` : ""}${signature ? `<img src="${signature}" alt="Signature" style="margin-left:8px">` : ""}</div>
    <div class="muted small">Authorized Signature</div>
  </div>
</div>
</body>
</html>`;
}
